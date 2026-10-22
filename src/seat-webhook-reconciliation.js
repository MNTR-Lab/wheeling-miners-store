/** V85 read-only paid-order ownership reconciliation. No D1 mutations or sales activation. */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {verifyCheckoutOwnership} from './seat-checkout-linkage.js';
import {prepareFulfillment} from './seat-fulfillment-transaction.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const result=(reason,extra={})=>({mode:'READ_ONLY',ready_for_fulfillment:false,reason,...extra});
export async function inspectPaidOrderOwnership(order,db,{now=new Date()}={}){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)return result('NO_ASSIGNED_SEATS',{ignored:true});
 if(!db?.prepare)return result('DATABASE_UNAVAILABLE');
 const attrs=order.note_attributes;
 if(!Array.isArray(attrs))return result('MISSING_CHECKOUT_ATTRIBUTES');
 const ids=attrs.filter(x=>x?.name==='wm_reservation_id');
 if(ids.length!==1||typeof ids[0].value!=='string'||!RID.test(ids[0].value))return result('INVALID_RESERVATION_LINK');
 const reservationId=ids[0].value;
 const reservation=await db.prepare('SELECT * FROM reservations WHERE id=?').bind(reservationId).first();
 if(!reservation)return result('RESERVATION_NOT_FOUND');
 const linked=await db.prepare('SELECT * FROM reservation_seats WHERE reservation_id=?').bind(reservationId).all();
 const seatRows=await db.prepare(`SELECT sku,status,shopify_variant_id,shopify_order_id,hold_id,hold_expires_at FROM seats WHERE sku IN (${parsed.seats.map(()=>'?').join(',')})`).bind(...parsed.seats.map(x=>x.sku)).all();
 const reservationSeats=(linked?.results||[]).map(x=>({sku:x.seat_sku??x.sku,shopify_variant_id:x.shopify_variant_id}));
 try{
  const ownership=verifyCheckoutOwnership(order,reservation,reservationSeats,{now});
  const plan=prepareFulfillment(order,reservation,seatRows?.results||[]);
  return result(plan.replayed?'ALREADY_FULFILLED':'OWNERSHIP_VERIFIED',{reservation_id:reservationId,order_id:parsed.orderId,seat_count:ownership.seatCount,ownership_verified:true,already_fulfilled:plan.replayed,proposed_seat_updates:plan.operations.length});
 }catch(e){return result('RECONCILIATION_REJECTED',{reservation_id:reservationId,order_id:parsed.orderId,detail:e.message});}
}
