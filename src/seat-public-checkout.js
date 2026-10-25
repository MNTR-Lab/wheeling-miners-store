/** Public checkout. FAIL CLOSED until independently approved production payment fulfillment. */
import {validateSeatRequest} from './seat-reservation-core.js';
import {prepareReservationTransaction,executeReservationTransaction} from './seat-reservation-transaction.js';
import {createControlledSeatCart} from './seat-shopify-cart.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const RID=/^wm_pub_[a-f0-9]{32}$/;
const PROD_HOST=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export function publicSalesEnabled(env){
 return env?.WM_ENVIRONMENT==='PRODUCTION'&&env?.SEAT_PUBLIC_SALES_ENABLED==='true'&&
 env?.SEAT_PUBLIC_SALES_APPROVED==='true'&&env?.SEAT_CONTROLLED_CART_ENABLED==='true'&&
 // Never accept customer payment while the paid-order commit is intentionally disabled.
 env?.SEAT_PAID_FULFILLMENT_ENABLED==='true'&&env?.SEAT_PRODUCTION_PAID_COMMIT_APPROVED==='true'&&
 typeof env?.SHOPIFY_WEBHOOK_SECRET==='string'&&env.SHOPIFY_WEBHOOK_SECRET.length>0&&
 typeof env?.SHOPIFY_CLIENT_ID==='string'&&env.SHOPIFY_CLIENT_ID.length>0&&
 typeof env?.SHOPIFY_CLIENT_SECRET==='string'&&env.SHOPIFY_CLIENT_SECRET.length>0&&
 typeof env?.SHOPIFY_STOREFRONT_TOKEN==='string'&&env.SHOPIFY_STOREFRONT_TOKEN.length>=10&&
 typeof env?.SHOPIFY_STORE_DOMAIN==='string'&&PROD_HOST.test(env.SHOPIFY_STORE_DOMAIN)&&
 env.SHOPIFY_STORE_DOMAIN!=='wheeling-miners-ticket-testing.myshopify.com';
}
async function parseBody(request){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>2048))throw Error('INVALID_BODY_SIZE');
 const bytes=await request.arrayBuffer();if(bytes.byteLength>2048)throw Error('INVALID_BODY_SIZE');
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_JSON');return data;
}
function conflict(error){return new Set(['SEATS_NOT_AVAILABLE','INCOMPLETE_SEAT_SET','INVALID_DATABASE_SEAT_SET','INVALID_VARIANT_MAPPING','INVALID_PRICE_TOTAL','RESERVATION_CONFLICT']).has(error?.message)}
export async function handlePublicCheckout(request,env,{fetchImpl=fetch,now=()=>new Date(),randomUUID=()=>crypto.randomUUID()}={}){
 const path=new URL(request.url).pathname;
 if(path!=='/api/seats/hold'&&path!=='/api/seats/checkout')return null;
 if(request.method!=='POST')return respond({error:'METHOD_NOT_ALLOWED'},405);
 if(!publicSalesEnabled(env))return respond({error:'PUBLIC_SALES_NOT_ENABLED'},423);
 if(!env?.SEAT_DB?.prepare||!env?.SEAT_DB?.batch)return respond({error:'DATABASE_UNAVAILABLE'},503);
 let data;try{data=await parseBody(request)}catch{return respond({error:'INVALID_JSON_OR_BODY'},400)}
 if(path==='/api/seats/hold'){
  if(Object.keys(data).sort().join(',')!=='skus')return respond({error:'INVALID_REQUEST'},422);
  let skus;try{skus=validateSeatRequest(data.skus).sort()}catch(e){return respond({error:e.message},422)}
  const current=now();if(!(current instanceof Date)||!Number.isFinite(current.valueOf()))return respond({error:'CLOCK_UNAVAILABLE'},503);
  const ids=skus.map(()=>'?').join(',');
  try{
   const query=await env.SEAT_DB.prepare(`SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku IN (${ids})`).bind(...skus).all();
   const rows=query?.results||[];
   if(rows.length!==skus.length)return respond({error:'SEAT_NOT_AVAILABLE'},409);
   const reservationId='wm_pub_'+randomUUID().replaceAll('-','');
   const checkoutNonce='wm_nonce_'+randomUUID().replaceAll('-','');
   if(!RID.test(reservationId)||!/^wm_nonce_[a-f0-9]{32}$/.test(checkoutNonce))return respond({error:'RANDOMNESS_UNAVAILABLE'},503);
   const expiresAt=new Date(current.valueOf()+15*60*1000).toISOString();
   const plan=prepareReservationTransaction(skus,rows,{reservationId,checkoutNonce,expiresAt,now:current});
   await executeReservationTransaction(env.SEAT_DB,plan,{authorized:true,now:current});
   return respond({ok:true,reservationId,expiresAt,seatCount:plan.seatCount,totalCents:plan.totalCents,checkoutEnabled:true},201);
  }catch(e){if(conflict(e))return respond({error:'SEAT_NOT_AVAILABLE'},409);console.error('Public hold unavailable',e?.message);return respond({error:'RESERVATION_UNAVAILABLE'},503)}
 }
 if(Object.keys(data).sort().join(',')!=='reservationId'||typeof data.reservationId!=='string'||!RID.test(data.reservationId))return respond({error:'INVALID_RESERVATION_ID'},422);
 try{
  const reservation=await env.SEAT_DB.prepare('SELECT * FROM reservations WHERE id=?').bind(data.reservationId).first();
  if(!reservation)return respond({error:'RESERVATION_NOT_FOUND'},404);
  const linked=await env.SEAT_DB.prepare('SELECT seat_sku,shopify_variant_id FROM reservation_seats WHERE reservation_id=?').bind(data.reservationId).all();
  const seatLinks=linked?.results||[];
  if(seatLinks.length<1||seatLinks.length>8)return respond({error:'INVALID_RESERVATION'},409);
  const skus=seatLinks.map(x=>x.seat_sku);validateSeatRequest(skus);
  const seats=await env.SEAT_DB.prepare(`SELECT sku,status,hold_id,hold_expires_at,shopify_order_id,shopify_variant_id FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
  if(seats?.results?.length!==skus.length)return respond({error:'SEAT_SNAPSHOT_MISMATCH'},409);
  const cart=await createControlledSeatCart({reservation,linkedSeats:seatLinks,seatRows:seats.results,env,fetchImpl,now:now()});
  return respond({ok:true,checkoutUrl:cart.checkoutUrl,reservationId:cart.reservationId,seatCount:cart.seatCount});
 }catch(e){const code=e?.message||'';if(/^(INVALID_|RESERVATION_|SEAT_|DUPLICATE_|SHOPIFY_VARIANT_MISMATCH|UNMAPPED_VARIANT)/.test(code))return respond({error:'RESERVATION_NOT_AVAILABLE'},409);console.error('Public checkout unavailable',code);return respond({error:'CHECKOUT_UNAVAILABLE'},503)}
}
