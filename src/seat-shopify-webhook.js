/** Signed Shopify paid-order intake. Production remains disabled without explicit approval. */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {previewPaidCommit} from './seat-paid-commit-preview.js';
import {preparePaidCommit,executePaidCommit} from './seat-paid-commit.js';
import {validShopifySignature} from './seat-shopify-webhook-signature.js';
import {paidWebhookStore,paidWebhookCommitEnabled} from './seat-webhook-environment.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const MAX=1024*1024;
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const fail=code=>{throw Error(code)};
export async function loadPaidCommitPlan(order,db,{verifiedPaidWebhook=false}={}){
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
 return preparePaidCommit(order,reservation,reservationSeats,seats.results,{verifiedPaidWebhook});
}
async function verifiedPaymentTime(orderId,env,fetchImpl,shop){
 if(!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)fail('SHOPIFY_CREDENTIALS_MISSING');
 const auth=await fetchImpl(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET}).toString()});
 if(!auth.ok)fail('SHOPIFY_AUTH_FAILED');
 const token=await auth.json();
 if(typeof token.access_token!=='string'||!token.scope?.split(',').map(s=>s.trim()).includes('read_orders'))fail('SHOPIFY_READ_ORDERS_REQUIRED');
 const headers={'x-shopify-access-token':token.access_token,'accept':'application/json'};
 const orderRes=await fetchImpl(`https://${shop}/admin/api/2026-10/orders/${orderId}.json?status=any&fields=id,financial_status`,{headers});
 if(!orderRes.ok)fail('SHOPIFY_ORDER_VERIFICATION_FAILED');
 const verified=(await orderRes.json())?.order;
 if(String(verified?.id)!==orderId||verified.financial_status!=='paid')fail('SHOPIFY_ORDER_NOT_PAID');
 const txRes=await fetchImpl(`https://${shop}/admin/api/2026-10/orders/${orderId}/transactions.json?fields=id,kind,status,processed_at,created_at,amount`,{headers});
 if(!txRes.ok)fail('SHOPIFY_TRANSACTION_VERIFICATION_FAILED');
 const tx=(await txRes.json())?.transactions;
 if(!Array.isArray(tx))fail('SHOPIFY_TRANSACTIONS_INVALID');
 const times=tx.filter(t=>t?.status==='success'&&['sale','capture'].includes(t?.kind)).map(t=>t.processed_at||t.created_at).filter(t=>typeof t==='string'&&/^\d{4}-\d\d-\d\dT/.test(t)&&Number.isFinite(Date.parse(t))).sort((a,b)=>Date.parse(a)-Date.parse(b));
 if(!times.length)fail('SHOPIFY_PAID_TRANSACTION_NOT_VERIFIED');
 return times[times.length-1];
}
export async function handleShopifyPaidWebhook(request,env,{fetchImpl=fetch}={}){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(typeof env?.SHOPIFY_WEBHOOK_SECRET!=='string'||!env.SHOPIFY_WEBHOOK_SECRET||!env.SEAT_DB?.prepare)return json({error:'WEBHOOK_NOT_CONFIGURED'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX))return json({error:'PAYLOAD_TOO_LARGE'},413);
 let raw;try{raw=await request.arrayBuffer();}catch{return json({error:'PAYLOAD_READ_FAILED'},400)}
 if(raw.byteLength>MAX)return json({error:'PAYLOAD_TOO_LARGE'},413);
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return json({error:'INVALID_SIGNATURE'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return json({error:'UNSUPPORTED_TOPIC'},422);
 const shop=paidWebhookStore(env);
 if(!shop||request.headers.get('x-shopify-shop-domain')!==shop)return json({error:'WRONG_SHOP'},403);
 let order;try{order=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return json({error:'INVALID_JSON'},400)}
 let parsed;try{parsed=parsePaidSeatOrder(order)}catch{return json({error:'INVALID_SEAT_ORDER',requires_reconciliation:true},422)}
 if(parsed.ignored)return json({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 if(!paidWebhookCommitEnabled(env,parsed.orderId)){
  let inspection;try{inspection=await previewPaidCommit(order,env.SEAT_DB)}catch{inspection={reason:'RECONCILIATION_UNAVAILABLE'}}
  return json({error:'MANUAL_RECONCILIATION_REQUIRED',staging:true,requires_reconciliation:true,inspection},503);
 }
 if(!env.SEAT_DB.batch)return json({error:'DATABASE_TRANSACTION_UNAVAILABLE',requires_reconciliation:true},503);
 try{
  // Shopify Admin independently verifies paid status and payment time.
  const paidAt=await verifiedPaymentTime(parsed.orderId,env,fetchImpl,shop);
  const plan=await loadPaidCommitPlan({...order,paid_at:paidAt},env.SEAT_DB,{verifiedPaidWebhook:true});
  if(plan.ignored)return json({ok:true,ignored:true});
  const result=await executePaidCommit(env.SEAT_DB,plan,{signatureVerified:true});
  return json({ok:true,order_id:plan.orderId,seat_count:result.seatCount,replayed:!!result.replayed});
 }catch(e){
  console.error('Paid seat commit rejected:',e?.message??'UNKNOWN');
  return json({error:'PAID_SEAT_COMMIT_FAILED',requires_reconciliation:true},503);
 }
}
