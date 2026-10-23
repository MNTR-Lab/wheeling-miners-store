/** V115: staging-only guarded seat hold executor. Does not create checkout or release seats.
 * Standalone holds MUST NOT be exposed publicly: the reservation and seat links
 * must be created atomically by the reservation transaction instead.
 */
import {validateSeatRequest,validateReservationId,evaluateHold,planHold} from './seat-reservation-core.js';
import {expiryMilliseconds} from './seat-expiry.js';
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const fail=code=>{throw Error(code)};
const CLEAR='DELETE FROM seat_admin_guard WHERE id=1';
const GUARD='INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
function expiry(value,now){
 let ms;
 try{ms=expiryMilliseconds(value)}catch{fail('INVALID_EXPIRATION')}
 if(!Number.isSafeInteger(ms)||ms<=now.valueOf())fail('INVALID_EXPIRATION');
 return ms;
}
export function prepareAtomicHold(skus,rows,{reservationId,expiresAt,now=new Date()}={}){
 const selected=validateSeatRequest(skus);
 validateReservationId(reservationId);
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 const ms=expiry(expiresAt,now);
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
 const operations=planHold(selected,{reservationId,expiresAt:ms});
 return {reservationId,expiresAt:ms,selectedSkus:[...selected],seatCount:selected.length,totalCents:audit.totalCents,operations};
}
export async function executeAtomicHold(db,plan,{authorized=false,now=new Date()}={}){
 if(authorized!==true)fail('HOLD_NOT_AUTHORIZED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 if(!plan||!Array.isArray(plan.operations)||!Number.isSafeInteger(plan.seatCount)||plan.seatCount<1||plan.seatCount>8||plan.operations.length!==plan.seatCount)fail('INVALID_PLAN');
 validateReservationId(plan.reservationId);
 const ms=expiry(plan.expiresAt,now);
 const skus=[];
 for(const op of plan.operations){
  if(!op||typeof op.sql!=='string'||op.expectedChanges!==1||!Array.isArray(op.params)||op.params.length!==3)fail('UNTRUSTED_PLAN');
  const [rid,storedExpiry,sku]=op.params;
  if(rid!==plan.reservationId||storedExpiry!==ms)fail('UNTRUSTED_PLAN');
  skus.push(sku);
 }
 validateSeatRequest(skus);
 if(!Array.isArray(plan.selectedSkus)||plan.selectedSkus.length!==skus.length||plan.selectedSkus.some((sku,i)=>sku!==skus[i]))fail('UNTRUSTED_PLAN');
 const trusted=planHold(skus,{reservationId:plan.reservationId,expiresAt:ms});
 for(let i=0;i<trusted.length;i++){
  if(plan.operations[i].sql!==trusted[i].sql)fail('UNTRUSTED_PLAN');
  if(plan.operations[i].params[2]!==trusted[i].params[2])fail('UNTRUSTED_PLAN');
 }
 const statements=[db.prepare(CLEAR)];
 for(const op of trusted)statements.push(db.prepare(op.sql).bind(...op.params),db.prepare(GUARD),db.prepare(CLEAR));
 await db.batch(statements);
 return {ok:true,reservationId:plan.reservationId,seatCount:plan.seatCount};
}
