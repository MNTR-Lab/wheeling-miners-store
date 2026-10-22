/** V102: atomic reservation hold executor, not routed or enabled for public sales.
 * Requires the existing seat_admin_guard CHECK(valid=1) migration and D1 batch transaction.
 * Caller must create the matching reservation and reservation_seats records in the same
 * transaction before making checkout available; this module alone does not do that.
 */
import {validateSeatRequest,validateReservationId,evaluateHold,planHold} from './seat-reservation-core.js';
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const fail=code=>{throw Error(code)};
const GUARD_CLEAR='DELETE FROM seat_admin_guard WHERE id=1';
const GUARD_CHECK='INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
/** Prepare a deterministic, server-owned hold plan from trusted D1 rows. */
export function prepareAtomicHold(skus,rows,{reservationId,expiresAt,now=new Date()}={}){
 const selected=validateSeatRequest(skus);
 validateReservationId(reservationId);
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 if(typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now.valueOf())fail('INVALID_EXPIRATION');
 if(!Array.isArray(rows)||rows.length!==selected.length)fail('INCOMPLETE_SEAT_SET');
 const seen=new Set(),variants=new Set();
 for(const row of rows){
  if(!row||!selected.includes(row.sku)||seen.has(row.sku))fail('INVALID_DATABASE_SEAT_SET');
  seen.add(row.sku);
  if(!GID.test(row.shopify_variant_id??'')||variants.has(row.shopify_variant_id))fail('INVALID_VARIANT_MAPPING');
  variants.add(row.shopify_variant_id);
 }
 const audit=evaluateHold(selected,rows,{nowEpochMs:now.valueOf()});
 if(!audit.ready)fail('SEATS_NOT_AVAILABLE');
 if(!Number.isSafeInteger(audit.totalCents)||audit.totalCents<=0)fail('INVALID_PRICE_TOTAL');
 const operations=planHold(selected,{reservationId,expiresAt});
 return {reservationId,expiresAt,seatCount:selected.length,totalCents:audit.totalCents,operations};
}
/** Execute guarded seat updates atomically; a missed row forces rollback. No routes call this yet. */
export async function executeAtomicHold(db,plan,{authorized=false}={}){
 if(authorized!==true)fail('HOLD_NOT_AUTHORIZED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(!plan||!Array.isArray(plan.operations)||!Number.isSafeInteger(plan.seatCount)||plan.seatCount<1||plan.seatCount>8||plan.operations.length!==plan.seatCount)fail('INVALID_PLAN');
 validateReservationId(plan.reservationId);
 if(typeof plan.expiresAt!=='string'||!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)<=Date.now())fail('INVALID_EXPIRATION');
 const skus=[];
 for(const op of plan.operations){
  if(!op||typeof op.sql!=='string'||op.expectedChanges!==1||!Array.isArray(op.params)||op.params.length!==3)fail('UNTRUSTED_PLAN');
  const [rid,expiry,sku]=op.params;
  if(rid!==plan.reservationId||expiry!==plan.expiresAt)fail('UNTRUSTED_PLAN');
  skus.push(sku);
 }
 validateSeatRequest(skus);
 const trusted=planHold(skus,{reservationId:plan.reservationId,expiresAt:plan.expiresAt});
 for(let i=0;i<trusted.length;i++)if(plan.operations[i].sql!==trusted[i].sql)fail('UNTRUSTED_PLAN');
 const statements=[db.prepare(GUARD_CLEAR)];
 for(const op of trusted){
  statements.push(db.prepare(op.sql).bind(...op.params));
  statements.push(db.prepare(GUARD_CHECK));
  statements.push(db.prepare(GUARD_CLEAR));
 }
 await db.batch(statements);
 return {ok:true,reservationId:plan.reservationId,seatCount:plan.seatCount};
}
