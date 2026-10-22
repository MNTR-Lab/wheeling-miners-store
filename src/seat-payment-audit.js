/** V81: read-only Shopify paid-order audit. No seat mutations or checkout activation. */
import {parsePaidSeatOrder,reconcilePaidSeats} from './seat-paid-order.js';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
export async function auditPaidOrder(order,db){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)return {mode:'READ_ONLY',ignored:true,order_id:parsed.orderId,seats:[],ready:false};
 const skus=parsed.seats.map(x=>x.sku);
 const placeholders=skus.map(()=>'?').join(',');
 const query=`SELECT sku,status,shopify_variant_id,shopify_order_id,hold_id,hold_expires_at FROM seats WHERE sku IN (${placeholders})`;
 const result=await db.prepare(query).bind(...skus).all();
 const rows=result.results||[];
 const review=reconcilePaidSeats(parsed,rows);
 const holds=new Set(rows.filter(x=>x.status==='HELD').map(x=>x.hold_id));
 const missingHold=rows.some(x=>x.status==='HELD'&&(!x.hold_id||!x.hold_expires_at));
 const sharedHold=holds.size===1&&!holds.has(null)&&!holds.has('');
 const issues=[...review.issues];
 if(review.ready&&(!sharedHold||missingHold))issues.push({reason:'RESERVATION_OWNERSHIP_UNVERIFIED'});
 // A valid hold is NOT sufficient proof that the paid order belongs to the reservation.
 // Payment fulfillment requires a separately verified reservation-to-checkout linkage.
 return {mode:'READ_ONLY',order_id:parsed.orderId,seat_count:skus.length,ready_for_automatic_fulfillment:false,seat_mapping_valid:review.ready||review.replayed,replayed:review.replayed,common_hold_present:sharedHold&&!missingHold,issues,seat_skus:skus};
}
export async function handlePaymentAudit(request,env){
 if(request.method!=='POST')return respond({error:'Method not allowed'},405);
 const length=Number(request.headers.get('content-length')||0);
 if(length>65536)return respond({error:'Payload too large'},413);
 let payload;try{const raw=await request.text();if(raw.length>65536)return respond({error:'Payload too large'},413);payload=JSON.parse(raw);}catch{return respond({error:'Invalid JSON'},400);}
 try{return respond(await auditPaidOrder(payload,env.SEAT_DB));}
 catch(e){if(['INVALID_ORDER','TOO_MANY_SEATS','DUPLICATE_SEAT_SKU','INVALID_LINE_ITEM'].includes(e.message))return respond({error:e.message},422);throw e;}
}
