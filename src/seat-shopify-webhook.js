/** V107: signed Shopify paid-order intake with explicit, default-OFF fulfillment gate.
 * Never set SEAT_PAID_FULFILLMENT_ENABLED before production schema, checkout,
 * mapping, and paid-order replay testing have been independently approved.
 */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {previewPaidCommit} from './seat-paid-commit-preview.js';
import {preparePaidCommit,executePaidCommit} from './seat-paid-commit.js';
import {validShopifySignature} from './seat-shopify-webhook-signature.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const MAX=1024*1024;
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const fail=code=>{throw Error(code)};
export async function loadPaidCommitPlan(order,db){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)return {ignored:true};
 const attrs=order.note_attributes;
 if(!Array.isArray(attrs))fail('MISSING_CHECKOUT_ATTRIBUTES');
 const ids=attrs.filter(a=>a?.name==='wm_reservation_id');
 if(ids.length!==1||typeof ids[0].value!=='string'||!RID.test(ids[0].value))fail('INVALID_RESERVATION_LINK');
 const reservation=await db.prepare('SELECT * FROM reservations WHERE id=?').bind(ids[0].value).first();
 if(!reservation)fail('RESERVATION_NOT_FOUND');
 const linked=await db.prepare('SELECT * FROM reservation_seats WHERE reservation_id=?').bind(ids[0].value).all();
 const skus=parsed.seats.map(s=>s.sku);
 const seats=await db.prepare(`SELECT sku,status,shopify_variant_id,shopify_order_id,hold_id,hold_expires_at FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
 if(!Array.isArray(linked?.results)||linked.results.length!==skus.length||!Array.isArray(seats?.results)||seats.results.length!==skus.length)fail('SEAT_COUNT_MISMATCH');
 const reservationSeats=linked.results.map(x=>({sku:x.seat_sku??x.sku,shopify_variant_id:x.shopify_variant_id}));
 return preparePaidCommit(order,reservation,reservationSeats,seats.results);
}
export async function handleShopifyPaidWebhook(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(typeof env?.SHOPIFY_WEBHOOK_SECRET!=='string'||!env.SHOPIFY_WEBHOOK_SECRET||!env.SEAT_DB?.prepare)return json({error:'WEBHOOK_NOT_CONFIGURED'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX))return json({error:'PAYLOAD_TOO_LARGE'},413);
 let raw;try{raw=await request.arrayBuffer();}catch{return json({error:'PAYLOAD_READ_FAILED'},400)}
 if(raw.byteLength>MAX)return json({error:'PAYLOAD_TOO_LARGE'},413);
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return json({error:'INVALID_SIGNATURE'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return json({error:'UNSUPPORTED_TOPIC'},422);
 let order;try{order=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return json({error:'INVALID_JSON'},400)}
 let parsed;try{parsed=parsePaidSeatOrder(order)}catch{return json({error:'INVALID_SEAT_ORDER',requires_reconciliation:true},422)}
 if(parsed.ignored)return json({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 // Default-off gate MUST run before any database write. A paid seat order
 // receives a retryable response until operators explicitly approve fulfillment.
 if(env.SEAT_PAID_FULFILLMENT_ENABLED!=='true'){
  let inspection;try{inspection=await previewPaidCommit(order,env.SEAT_DB)}catch{inspection={reason:'RECONCILIATION_UNAVAILABLE'}}
  return json({error:'MANUAL_RECONCILIATION_REQUIRED',staging:true,requires_reconciliation:true,inspection},503);
 }
 // Even when explicitly enabled, reject unsigned, mismatched, expired,
 // or competing claims before constructing any write transaction.
 if(!env.SEAT_DB.batch)return json({error:'DATABASE_TRANSACTION_UNAVAILABLE',requires_reconciliation:true},503);
 try{
  const plan=await loadPaidCommitPlan(order,env.SEAT_DB);
  if(plan.ignored)return json({ok:true,ignored:true});
  const result=await executePaidCommit(env.SEAT_DB,plan,{signatureVerified:true});
  return json({ok:true,order_id:plan.orderId,seat_count:result.seatCount,replayed:!!result.replayed});
 }catch{
  // Shopify retries on 503; never acknowledge a partial or unverified payment.
  return json({error:'PAID_SEAT_COMMIT_FAILED',requires_reconciliation:true},503);
 }
}
