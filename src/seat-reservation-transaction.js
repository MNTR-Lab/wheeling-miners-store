/** V113: staging-only atomic reservation. D1 expiry columns use epoch milliseconds. */
import {prepareAtomicHold} from './seat-hold-transaction.js';
import {validateSeatRequest,validateReservationId} from './seat-reservation-core.js';
import {expiryMilliseconds} from './seat-expiry.js';
const NONCE=/^[A-Za-z0-9_-]{24,128}$/;
const VARIANT=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const fail=code=>{throw Error(code)};
const CLEAR='DELETE FROM seat_admin_guard WHERE id=1';
const GUARD='INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
const HOLD="UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='AVAILABLE' AND hold_id IS NULL AND shopify_order_id IS NULL AND shopify_variant_id=?";
function normalizedExpiry(value,now){
 let ms;try{ms=expiryMilliseconds(value)}catch{fail('INVALID_EXPIRATION')}
 if(!Number.isSafeInteger(ms)||ms<=now.valueOf())fail('INVALID_EXPIRATION');
 return ms;
}
export function prepareReservationTransaction(skus,rows,{reservationId,checkoutNonce,expiresAt,now=new Date()}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 if(typeof checkoutNonce!=='string'||!NONCE.test(checkoutNonce))fail('INVALID_CHECKOUT_NONCE');
 const expiryMs=normalizedExpiry(expiresAt,now);
 // Existing offline hold planner validates availability and totals, but uses ISO fixtures.
 const hold=prepareAtomicHold(skus,rows,{reservationId,expiresAt:new Date(expiryMs).toISOString(),now});
 const bySku=new Map(rows.map(row=>[row.sku,row]));
 const seats=validateSeatRequest(skus).sort().map(sku=>({sku,variantId:bySku.get(sku).shopify_variant_id}));
 return {reservationId,checkoutNonce,expiresAt:expiryMs,seatCount:hold.seatCount,totalCents:hold.totalCents,seats};
}
/** All writes occur in one D1 batch. Failed guarded updates must rollback the batch. */
export async function executeReservationTransaction(db,plan,{authorized=false,now=new Date()}={}){
 if(authorized!==true)fail('RESERVATION_NOT_AUTHORIZED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(!plan||typeof plan!=='object')fail('INVALID_PLAN');
 validateReservationId(plan.reservationId);
 if(typeof plan.checkoutNonce!=='string'||!NONCE.test(plan.checkoutNonce))fail('INVALID_CHECKOUT_NONCE');
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 const expiryMs=normalizedExpiry(plan.expiresAt,now);
 if(!Array.isArray(plan.seats))fail('INVALID_PLAN');
 const skus=validateSeatRequest(plan.seats.map(s=>s?.sku)).sort();
 if(plan.seatCount!==skus.length||!Number.isSafeInteger(plan.totalCents)||plan.totalCents<=0)fail('INVALID_PLAN');
 const variants=new Set();
 for(let i=0;i<skus.length;i++){
  const seat=plan.seats[i];
  if(seat.sku!==skus[i]||typeof seat.variantId!=='string'||!VARIANT.test(seat.variantId)||variants.has(seat.variantId))fail('INVALID_PLAN');
  variants.add(seat.variantId);
 }
 const statements=[db.prepare(CLEAR),db.prepare("INSERT INTO reservations (id,status,created_at,checkout_nonce,expires_at) VALUES (?,'HELD',?,?,?)").bind(plan.reservationId,now.valueOf(),plan.checkoutNonce,expiryMs)];
 for(const seat of plan.seats){
  statements.push(db.prepare('INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id) VALUES (?,?,?)').bind(plan.reservationId,seat.sku,seat.variantId));
  statements.push(db.prepare(HOLD).bind(plan.reservationId,expiryMs,seat.sku,seat.variantId));
  statements.push(db.prepare(GUARD),db.prepare(CLEAR));
 }
 await db.batch(statements);
 return {ok:true,reservationId:plan.reservationId,seatCount:skus.length,expiresAt:expiryMs};
}
