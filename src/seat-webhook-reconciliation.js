/** V90: fail-closed, read-only paid-order reconciliation. No seat writes or sale activation. */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {verifyCheckoutOwnership} from './seat-checkout-linkage.js';
import {prepareFulfillment} from './seat-fulfillment-transaction.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const result=(reason,extra={})=>({mode:'READ_ONLY',ready_for_fulfillment:false,reason,...extra});
const reject=(detail,extra={})=>result('RECONCILIATION_REJECTED',{detail,...extra});
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
 const context={reservation_id:reservationId,order_id:parsed.orderId};
 if(!Array.isArray(linked?.results)||!Array.isArray(seatRows?.results))return reject('INVALID_DATABASE_RESULT',context);
 const linkedSeats=linked.results;
 if(linkedSeats.length!==parsed.seats.length)return reject('RESERVATION_SEAT_COUNT_MISMATCH',context);
 const reservationSeats=linkedSeats.map(x=>({sku:x?.seat_sku??x?.sku,shopify_variant_id:x?.shopify_variant_id}));
 const skuSet=new Set(parsed.seats.map(x=>x.sku));
 if(reservationSeats.some(x=>!skuSet.has(x.sku)))return reject('RESERVATION_SEAT_SET_MISMATCH',context);
 if(seatRows.results.length!==parsed.seats.length)return reject('DATABASE_SEAT_COUNT_MISMATCH',context);
 const seen=new Set();
 for(const row of seatRows.results){
  if(!row||!skuSet.has(row.sku))return reject('UNEXPECTED_DATABASE_SEAT',context);
  if(seen.has(row.sku))return reject('DUPLICATE_DATABASE_SEAT',context);
  seen.add(row.sku);
 }
 try{
  const ownership=verifyCheckoutOwnership(order,reservation,reservationSeats,{now});
  const plan=prepareFulfillment(order,reservation,seatRows.results);
  return result(plan.replayed?'ALREADY_FULFILLED':'OWNERSHIP_VERIFIED',{...context,seat_count:ownership.seatCount,ownership_verified:true,already_fulfilled:plan.replayed,proposed_seat_updates:plan.operations.length});
 }catch(e){return reject(e.message,context);}
}
