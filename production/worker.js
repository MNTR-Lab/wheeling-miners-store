/** Production-only controlled purchase. Default OFF. TEST continues to use src/worker.js.
 * Public requests never receive controlled-test authorization.
 */
import baseWorker from '../src/worker.js';
import {handleAdminControlledCart} from './seat-admin-controlled-cart.js';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
import {validShopifySignature} from '../src/seat-shopify-webhook-signature.js';
import {parsePaidSeatOrder} from '../src/seat-paid-order.js';
import {prepareReservationTransaction,executeReservationTransaction} from '../src/seat-reservation-transaction.js';
const SHOP='186815-4c.myshopify.com';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
export function controlledTestConfig(env,now=Date.now()){
 if(env?.WM_ENVIRONMENT!=='PRODUCTION'||env.SHOPIFY_STORE_DOMAIN!==SHOP||env.SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED!=='true'||env.SEAT_PRODUCTION_CONTROLLED_TEST_APPROVED!=='true')return null;
 // No general sales, cart, or fulfillment authority is permitted during this rehearsal.
 for(const key of ['SEAT_PUBLIC_SALES_ENABLED','SEAT_PUBLIC_SALES_APPROVED','SEAT_CONTROLLED_CART_ENABLED','SEAT_PAID_FULFILLMENT_ENABLED','SEAT_PRODUCTION_PAID_COMMIT_APPROVED'])if(env[key]==='true')return null;
 const sku=env.SEAT_PRODUCTION_CONTROLLED_SKU,rid=env.SEAT_PRODUCTION_CONTROLLED_RESERVATION_ID;
 const price=Number(env.SEAT_PRODUCTION_CONTROLLED_PRICE_CENTS),until=Date.parse(env.SEAT_PRODUCTION_CONTROLLED_TEST_UNTIL||'');
 if(!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(sku||'')||!/^wm_control_[a-f0-9]{32}$/.test(rid||''))return null;
 if(!Number.isSafeInteger(price)||price<=0||!Number.isFinite(until)||until<=now||until>now+3600000)return null;
 return {sku,rid,price,until};
}
async function bytes(request,max){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('BODY_TOO_LARGE');
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('BODY_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length}return out;
}
const rebuild=(request,raw)=>new Request(request.url,{method:request.method,headers:request.headers,body:raw});
const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
function authorized(request,env){const expected=env?.SEAT_ADMIN_TOKEN,supplied=request.headers.get('authorization');if(typeof expected!=='string'||expected.length<32||!supplied?.startsWith('Bearer '))return false;const token=supplied.slice(7);if(token.length!==expected.length)return false;let difference=0;for(let i=0;i<token.length;i++)difference|=token.charCodeAt(i)^expected.charCodeAt(i);return difference===0}
export async function handleControlledProductionWebhook(request,env,{fetchImpl=fetch,now=Date.now()}={}){
 const config=controlledTestConfig(env,now);
 if(!config&&env?.SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED==='true'&&['SEAT_PUBLIC_SALES_ENABLED','SEAT_PUBLIC_SALES_APPROVED','SEAT_CONTROLLED_CART_ENABLED','SEAT_PAID_FULFILLMENT_ENABLED','SEAT_PRODUCTION_PAID_COMMIT_APPROVED'].some(key=>env[key]==='true'))return reply({error:'CONFLICTING_CONTROLLED_CONFIGURATION'},423);
 if(!config||request.method!=='POST')return handleShopifyPaidWebhook(request,env,{fetchImpl});
 let raw;try{raw=await bytes(request,1024*1024)}catch{return reply({error:'PAYLOAD_TOO_LARGE'},413)}
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return reply({error:'INVALID_SIGNATURE'},401);
 let order,parsed;try{order=decode(raw);parsed=parsePaidSeatOrder(order)}catch{return reply({error:'INVALID_SEAT_ORDER'},422)}
 const ids=Array.isArray(order.note_attributes)?order.note_attributes.filter(x=>x?.name==='wm_reservation_id'):[];
 const exact=!parsed.ignored&&parsed.seats.length===1&&parsed.seats[0].sku===config.sku&&ids.length===1&&ids[0].value===config.rid;
 // Only this exact signed seat/reservation receives invocation-local permission.
 // The original handler still verifies topic/store, Shopify paid state and time,
 // nonce, variant mapping, ownership, expiry, atomicity, and replay behavior.
 const scoped=exact?{...env,SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true'}:env;
 return handleShopifyPaidWebhook(rebuild(request,raw),scoped,{fetchImpl});
}
export async function handleControlledReservation(request,env,{now=Date.now(),randomUUID=()=>crypto.randomUUID()}={}){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(!authorized(request,env))return reply({error:'UNAUTHORIZED'},401);
 const config=controlledTestConfig(env,now);if(!config)return reply({error:'CONTROLLED_TEST_DISABLED'},423);
 if(!env.SEAT_DB?.prepare||!env.SEAT_DB?.batch)return reply({error:'DATABASE_UNAVAILABLE'},503);
 let body;try{body=decode(await bytes(request,1024))}catch{return reply({error:'INVALID_BODY'},400)}
 if(!body||Object.keys(body).sort().join(',')!=='confirmation,operator'||body.confirmation!==`RESERVE PRODUCTION TEST ${config.sku}`||typeof body.operator!=='string'||body.operator.trim().length<2||body.operator.length>120)return reply({error:'CONFIRMATION_REQUIRED'},422);
 const db=env.SEAT_DB;
 const row=await db.prepare('SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku=?').bind(config.sku).first();
 if(!row||row.status!=='UNRELEASED'||row.hold_id!==null||row.shopify_order_id!==null||row.price_cents!==config.price||!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(row.shopify_variant_id||''))return reply({error:'SEAT_NOT_ELIGIBLE'},409);
 const nonce='wm_nonce_'+randomUUID().replaceAll('-','');
 if(!/^wm_nonce_[a-f0-9]{32}$/.test(nonce))return reply({error:'RANDOMNESS_UNAVAILABLE'},503);
 const expiresAt=Math.min(now+900000,config.until);
 try{
  const plan=prepareReservationTransaction([row.sku],[{...row,status:'AVAILABLE'}],{reservationId:config.rid,checkoutNonce:nonce,expiresAt,now:new Date(now)});
  const scopedDB={prepare:sql=>db.prepare(sql),batch:statements=>db.batch([
   db.prepare('DELETE FROM seat_admin_guard WHERE id=1'),
   db.prepare("UPDATE seats SET status='AVAILABLE',updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='UNRELEASED' AND hold_id IS NULL AND shopify_order_id IS NULL AND price_cents=? AND shopify_variant_id=?").bind(row.sku,config.price,row.shopify_variant_id),
   db.prepare('INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)'),
   db.prepare('DELETE FROM seat_admin_guard WHERE id=1'),...statements])};
  await executeReservationTransaction(scopedDB,plan,{authorized:true,now:new Date(now)});
  console.log('Controlled production reservation created',{sku:row.sku,reservationId:config.rid});
  return reply({ok:true,sku:row.sku,reservationId:config.rid,expiresAt:new Date(expiresAt).toISOString(),priceCents:config.price,publicSalesEnabled:false},201);
 }catch{return reply({error:'RESERVATION_CONFLICT'},409)}
}
export default {async fetch(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(env?.SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED==='true'&&['/api/seats/hold','/api/seats/checkout'].includes(path))return reply({error:'PUBLIC_SALES_NOT_ENABLED'},423);
 if(path==='/api/seats/admin/production-test-status'){
  if(!authorized(request,env))return reply({error:'UNAUTHORIZED'},401);
  if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
  if(env?.WM_ENVIRONMENT!=='PRODUCTION'||env.SHOPIFY_STORE_DOMAIN!==SHOP)return reply({error:'PRODUCTION_ONLY'},423);
  const sku=env.SEAT_PRODUCTION_CONTROLLED_SKU;
  if(!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(sku||''))return reply({error:'CONTROLLED_SEAT_NOT_CONFIGURED'},423);
  const seat=await env.SEAT_DB.prepare('SELECT sku,status,price_cents,hold_id,hold_expires_at,shopify_order_id FROM seats WHERE sku=?').bind(sku).first();
  if(!seat)return reply({error:'SEAT_NOT_FOUND'},404);
  let reservation=null;
  if(/^wm_control_[a-f0-9]{32}$/.test(env.SEAT_PRODUCTION_CONTROLLED_RESERVATION_ID||''))reservation=await env.SEAT_DB.prepare('SELECT id,status,expires_at,shopify_order_id FROM reservations WHERE id=?').bind(env.SEAT_PRODUCTION_CONTROLLED_RESERVATION_ID).first();
  return reply({ok:true,seat,reservation,controlledWindowOpen:!!controlledTestConfig(env),publicSalesEnabled:false,readOnly:true});
 }
 if(path==='/api/seats/webhooks/shopify')return handleControlledProductionWebhook(request,env);
 if(path==='/api/seats/admin/production-test-reservation')return handleControlledReservation(request,env);
 if(path==='/api/seats/admin/production-test-cart'){
  if(!authorized(request,env))return reply({error:'UNAUTHORIZED'},401);
  if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  const config=controlledTestConfig(env);if(!config)return reply({error:'CONTROLLED_TEST_DISABLED'},423);
  let raw,body;try{raw=await bytes(request,1024);body=decode(raw)}catch{return reply({error:'INVALID_BODY'},400)}
  if(!body||Object.keys(body).join(',')!=='reservationId'||body.reservationId!==config.rid)return reply({error:'WRONG_CONTROLLED_RESERVATION'},422);
  const url=new URL(request.url);url.pathname='/api/seats/admin/controlled-cart';
  return handleAdminControlledCart(new Request(url,{method:'POST',headers:request.headers,body:raw}),{...env,SEAT_CONTROLLED_CART_ENABLED:'true'});
 }
 return baseWorker.fetch(request,env,ctx);
}};
