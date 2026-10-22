/** V106: signed-order-compatible, read-only paid commit preparation from D1.
 * This does not write, acknowledge a Shopify webhook, or activate checkout.
 */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {preparePaidCommit} from './seat-paid-commit.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const result=(reason,extra={})=>({mode:'READ_ONLY',fulfillment_enabled:false,reason,...extra});
export async function previewPaidCommit(order,db,{now=new Date()}={}){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)return result('NO_ASSIGNED_SEATS',{ignored:true});
 if(!db?.prepare)return result('DATABASE_UNAVAILABLE');
 const attrs=order.note_attributes;
 if(!Array.isArray(attrs))return result('MISSING_CHECKOUT_ATTRIBUTES');
 const ids=attrs.filter(x=>x?.name==='wm_reservation_id');
 if(ids.length!==1||typeof ids[0].value!=='string'||!RID.test(ids[0].value))return result('INVALID_RESERVATION_LINK');
 const rid=ids[0].value;
 try{
  const reservation=await db.prepare('SELECT * FROM reservations WHERE id=?').bind(rid).first();
  if(!reservation)return result('RESERVATION_NOT_FOUND');
  const linked=await db.prepare('SELECT * FROM reservation_seats WHERE reservation_id=?').bind(rid).all();
  if(!Array.isArray(linked?.results)||linked.results.length!==parsed.seats.length)return result('RESERVATION_SEAT_COUNT_MISMATCH');
  const skus=parsed.seats.map(x=>x.sku);
  const seats=await db.prepare(`SELECT sku,status,shopify_variant_id,shopify_order_id,hold_id,hold_expires_at FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
  if(!Array.isArray(seats?.results)||seats.results.length!==skus.length)return result('DATABASE_SEAT_COUNT_MISMATCH');
  const reservationSeats=linked.results.map(x=>({sku:x.seat_sku??x.sku,shopify_variant_id:x.shopify_variant_id}));
  const plan=preparePaidCommit(order,reservation,reservationSeats,seats.results,{now});
  return result(plan.replayed?'ALREADY_FULFILLED':'PAID_COMMIT_PREPARED',{
   ownership_verified:true,order_id:plan.orderId,reservation_id:plan.reservationId,
   seat_count:plan.seatCount,proposed_seat_updates:plan.operations.length,
   proposed_reservation_updates:plan.replayed?0:1,already_fulfilled:plan.replayed
  });
 }catch(error){return result('PAID_COMMIT_REJECTED',{detail:error?.message??'UNKNOWN'});}
}
