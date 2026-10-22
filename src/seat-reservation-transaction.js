/** V104: plan an atomic reservation + linked-seat hold. Staging only; no public route.
 * Schema contract: reservations(id,status,checkout_nonce,expires_at),
 * reservation_seats(reservation_id,seat_sku,shopify_variant_id),
 * seats(sku,status,hold_id,hold_expires_at,shopify_order_id,shopify_variant_id).
 * Requires seat_admin_guard(id,valid CHECK(valid=1)).
 */
import {prepareAtomicHold} from './seat-hold-transaction.js';
import {validateSeatRequest,validateReservationId,planHold} from './seat-reservation-core.js';
const NONCE=/^[A-Za-z0-9_-]{24,128}$/;
const fail=code=>{throw Error(code)};
const CLEAR='DELETE FROM seat_admin_guard WHERE id=1';
const GUARD='INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
export function prepareReservationTransaction(skus,rows,{reservationId,checkoutNonce,expiresAt,now=new Date()}={}){
 if(typeof checkoutNonce!=='string'||!NONCE.test(checkoutNonce))fail('INVALID_CHECKOUT_NONCE');
 const hold=prepareAtomicHold(skus,rows,{reservationId,expiresAt,now});
 const bySku=new Map(rows.map(row=>[row.sku,row]));
 const seats=validateSeatRequest(skus).sort().map(sku=>({sku,variantId:bySku.get(sku).shopify_variant_id}));
 return {reservationId,checkoutNonce,expiresAt,seatCount:hold.seatCount,totalCents:hold.totalCents,seats};
}
/** Reconstruct every SQL statement from validated plan fields; never execute caller-supplied SQL.
 * D1 batch is transactional: guard CHECK failure rolls back reservation, links and holds.
 */
export async function executeReservationTransaction(db,plan,{authorized=false,now=new Date()}={}){
 if(authorized!==true)fail('RESERVATION_NOT_AUTHORIZED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(!plan||typeof plan!=='object')fail('INVALID_PLAN');
 validateReservationId(plan.reservationId);
 if(typeof plan.checkoutNonce!=='string'||!NONCE.test(plan.checkoutNonce))fail('INVALID_CHECKOUT_NONCE');
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 if(typeof plan.expiresAt!=='string'||!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)<=now.valueOf())fail('INVALID_EXPIRATION');
 if(!Array.isArray(plan.seats))fail('INVALID_PLAN');
 const skus=validateSeatRequest(plan.seats.map(s=>s?.sku)).sort();
 if(plan.seatCount!==skus.length||!Number.isSafeInteger(plan.totalCents)||plan.totalCents<=0)fail('INVALID_PLAN');
 const variants=new Set();
 for(let i=0;i<skus.length;i++){
  const seat=plan.seats[i];
  if(seat.sku!==skus[i]||typeof seat.variantId!=='string'||!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(seat.variantId)||variants.has(seat.variantId))fail('INVALID_PLAN');
  variants.add(seat.variantId);
 }
 const holdOps=planHold(skus,{reservationId:plan.reservationId,expiresAt:plan.expiresAt});
 const statements=[db.prepare(CLEAR),db.prepare("INSERT INTO reservations (id,status,checkout_nonce,expires_at) VALUES (?,'HELD',?,?)").bind(plan.reservationId,plan.checkoutNonce,plan.expiresAt)];
 for(let i=0;i<skus.length;i++){
  const seat=plan.seats[i],op=holdOps[i];
  statements.push(db.prepare('INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id) VALUES (?,?,?)').bind(plan.reservationId,seat.sku,seat.variantId));
  statements.push(db.prepare(op.sql.replace('shopify_variant_id IS NOT NULL','shopify_variant_id=?')).bind(...op.params,seat.variantId));
  statements.push(db.prepare(GUARD),db.prepare(CLEAR));
 }
 await db.batch(statements);
 return {ok:true,reservationId:plan.reservationId,seatCount:skus.length,expiresAt:plan.expiresAt};
}
