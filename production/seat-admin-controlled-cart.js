/** Admin-only controlled cart endpoint. Caller authentication occurs in seat-admin.js.
 * Disabled by default. Never creates reservations or changes D1 inventory.
 */
import {createControlledSeatCart} from './seat-shopify-cart.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const RID=/^[A-Za-z0-9_-]{16,128}$/;
export async function handleAdminControlledCart(request,env,{fetchImpl=fetch,now=new Date()}={}){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env?.SEAT_CONTROLLED_CART_ENABLED!=='true')return reply({error:'CONTROLLED_CART_DISABLED'},423);
 if(!env?.SEAT_DB?.prepare)return reply({error:'DATABASE_UNAVAILABLE'},503);
 const len=request.headers.get('content-length');
 if(len!==null&&(!/^\d+$/.test(len)||Number(len)>1024))return reply({error:'INVALID_BODY'},413);
 let bytes;try{bytes=await request.arrayBuffer();}catch{return reply({error:'INVALID_BODY'},400)}
 if(bytes.byteLength>1024)return reply({error:'INVALID_BODY'},413);
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'INVALID_JSON'},400)}
 const id=body?.reservationId;
 if(typeof id!=='string'||!RID.test(id)||Object.keys(body).length!==1)return reply({error:'INVALID_RESERVATION_ID'},422);
 try{
  const reservation=await env.SEAT_DB.prepare('SELECT * FROM reservations WHERE id=?').bind(id).first();
  if(!reservation)return reply({error:'RESERVATION_NOT_FOUND'},404);
  const linked=await env.SEAT_DB.prepare('SELECT seat_sku,shopify_variant_id FROM reservation_seats WHERE reservation_id=?').bind(id).all();
  if(!Array.isArray(linked?.results)||linked.results.length<1||linked.results.length>8)return reply({error:'INVALID_RESERVATION_SEATS'},409);
  const skus=linked.results.map(s=>s.seat_sku);
  if(skus.some(s=>typeof s!=='string')||new Set(skus).size!==skus.length)return reply({error:'INVALID_RESERVATION_SEATS'},409);
  const rows=await env.SEAT_DB.prepare(`SELECT sku,status,hold_id,hold_expires_at,shopify_order_id,shopify_variant_id FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
  if(!Array.isArray(rows?.results)||rows.results.length!==skus.length)return reply({error:'SEAT_SNAPSHOT_MISMATCH'},409);
  const cart=await createControlledSeatCart({reservation,linkedSeats:linked.results,seatRows:rows.results,env,fetchImpl,now});
  return reply({...cart,adminOnly:true,publicCheckoutEnabled:false});
 }catch(error){
  const code=error?.message;
  const conflicts=new Set(['INVALID_RESERVATION','INVALID_CHECKOUT_NONCE','INVALID_RESERVATION_STATUS','RESERVATION_ALREADY_ORDERED','INVALID_RESERVATION_EXPIRY','RESERVATION_EXPIRED','INVALID_SEAT_SET','INVALID_SEAT_SKU','DUPLICATE_SEAT_SKU','UNMAPPED_VARIANT','DUPLICATE_SHOPIFY_VARIANT','SEAT_SNAPSHOT_MISMATCH','DUPLICATE_OR_INVALID_SEAT_SNAPSHOT','SEAT_NOT_HELD_BY_RESERVATION','SHOPIFY_VARIANT_MISMATCH','SEAT_EXPIRY_MISMATCH','DUPLICATE_VARIANTS']);
  if(conflicts.has(code))return reply({error:code},409);
  console.error('Controlled cart admin error',code);
  return reply({error:'CONTROLLED_CART_UNAVAILABLE'},503);
 }
}
