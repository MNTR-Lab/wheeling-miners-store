/** V99: authenticated staging-only preview of a Shopify paid order against D1.
 * This endpoint never verifies payment itself, writes to D1, acknowledges Shopify,
 * marks seats sold, or enables public checkout.
 */
import {inspectPaidOrderOwnership} from './seat-webhook-reconciliation.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:H});
const MAX_BYTES=65536;
const ORDER_ERRORS=new Set(['INVALID_ORDER','INVALID_SEAT_LIMIT','TOO_MANY_SEATS','DUPLICATE_SEAT_SKU','INVALID_LINE_ITEM','DUPLICATE_PAID_VARIANT']);
export async function handleOwnershipPreview(request,env){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(!env?.SEAT_DB?.prepare)return reply({error:'DATABASE_UNAVAILABLE'},503);
 const len=request.headers.get('content-length');
 if(len!==null&&(!/^\d+$/.test(len)||!Number.isSafeInteger(Number(len))||Number(len)>MAX_BYTES))return reply({error:'PAYLOAD_TOO_LARGE'},413);
 let raw;
 try{raw=await request.arrayBuffer();}catch{return reply({error:'PAYLOAD_READ_FAILED'},400);}
 if(raw.byteLength>MAX_BYTES)return reply({error:'PAYLOAD_TOO_LARGE'},413);
 let order;
 try{order=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return reply({error:'INVALID_JSON'},400);}
 try{
  const inspection=await inspectPaidOrderOwnership(order,env.SEAT_DB);
  return reply({mode:'ADMIN_STAGING',sales_enabled:false,preview_only:true,payment_verified:false,fulfillment_executed:false,inspection});
 }catch(e){
  if(ORDER_ERRORS.has(e?.message))return reply({error:e.message,preview_only:true},422);
  return reply({error:'PREVIEW_UNAVAILABLE',preview_only:true},503);
 }
}
