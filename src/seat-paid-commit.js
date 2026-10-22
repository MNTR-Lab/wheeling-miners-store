/** V105: atomic paid-seat + reservation commit. NOT wired to webhook or sales. */
import {prepareFulfillment} from './seat-fulfillment-transaction.js';
import {verifyCheckoutOwnership} from './seat-checkout-linkage.js';
const fail=code=>{throw Error(code)};
const CLEAR='DELETE FROM seat_admin_guard WHERE id=1';
const GUARD='INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
const SEAT_UPDATE="UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_order_id IS NULL AND shopify_variant_id=?";
const RES_UPDATE="UPDATE reservations SET status='PAID',shopify_order_id=? WHERE id=? AND status IN ('HELD','CHECKOUT_PENDING') AND shopify_order_id IS NULL";
/** All inputs except the Shopify order must come from trusted D1 reads. */
export function preparePaidCommit(order,reservation,reservationSeats,seatRows,{now=new Date()}={}){
 const ownership=verifyCheckoutOwnership(order,reservation,reservationSeats,{now});
 const plan=prepareFulfillment(order,reservation,seatRows);
 if(plan.replayed)return {replayed:true,orderId:plan.orderId,reservationId:ownership.reservationId,seatCount:plan.seatCount,operations:[]};
 if(plan.operations.length!==ownership.seatCount)fail('SEAT_COUNT_MISMATCH');
 return {replayed:false,orderId:plan.orderId,reservationId:ownership.reservationId,seatCount:plan.seatCount,operations:plan.operations};
}
/** Only a caller that has independently verified the Shopify webhook signature may authorize. */
export async function executePaidCommit(db,plan,{signatureVerified=false}={}){
 if(signatureVerified!==true)fail('SIGNATURE_NOT_VERIFIED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(!plan||!/^[1-9]\d*$/.test(String(plan.orderId??''))||!/^[A-Za-z0-9_-]{16,128}$/.test(plan.reservationId??'')||!Number.isInteger(plan.seatCount)||plan.seatCount<1||plan.seatCount>8||!Array.isArray(plan.operations))fail('INVALID_PLAN');
 if(plan.replayed){if(plan.operations.length)fail('INVALID_REPLAY_PLAN');return {ok:true,replayed:true,seatCount:plan.seatCount};}
 if(plan.operations.length!==plan.seatCount)fail('INVALID_PLAN');
 const skus=new Set(),variants=new Set();
 const statements=[db.prepare(CLEAR)];
 for(const op of plan.operations){
  if(op?.sql!==SEAT_UPDATE||op.expectedChanges!==1||!Array.isArray(op.params)||op.params.length!==4)fail('UNTRUSTED_PLAN');
  const [orderId,sku,rid,variant]=op.params;
  if(String(orderId)!==String(plan.orderId)||rid!==plan.reservationId||!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(sku)||!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(variant)||skus.has(sku)||variants.has(variant))fail('INVALID_PLAN');
  skus.add(sku);variants.add(variant);
  statements.push(db.prepare(SEAT_UPDATE).bind(...op.params),db.prepare(GUARD),db.prepare(CLEAR));
 }
 statements.push(db.prepare(RES_UPDATE).bind(plan.orderId,plan.reservationId),db.prepare(GUARD),db.prepare(CLEAR));
 await db.batch(statements);
 return {ok:true,replayed:false,seatCount:plan.seatCount,orderId:plan.orderId};
}
