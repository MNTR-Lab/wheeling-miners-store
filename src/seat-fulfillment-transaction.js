/** V97: fail-closed atomic D1 fulfillment planner/executor. NOT routed or enabled.
 * Trusted caller MUST independently verify Shopify HMAC and reservation ownership.
 */
import {parsePaidSeatOrder,reconcilePaidSeats} from './seat-paid-order.js';
const RESERVATION=/^[A-Za-z0-9_-]{16,128}$/;
const ORDER=/^[1-9]\d*$/;
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const VARIANT=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const UPDATE="UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_order_id IS NULL AND shopify_variant_id=?";
const fail=code=>{throw Error(code)};
export function prepareFulfillment(order,reservation,rows){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)fail('NO_ASSIGNED_SEATS');
 if(!RESERVATION.test(reservation?.id??''))fail('INVALID_RESERVATION_ID');
 if(!ORDER.test(parsed.orderId))fail('INVALID_ORDER_ID');
 if(reservation.shopify_order_id!=null&&String(reservation.shopify_order_id)!==parsed.orderId)fail('ORDER_OWNERSHIP_MISMATCH');
 if(!['CHECKOUT_PENDING','HELD','PAID'].includes(reservation.status))fail('RESERVATION_STATE_INVALID');
 if(!Array.isArray(rows)||rows.length!==parsed.seats.length)fail('INCOMPLETE_SEAT_SET');
 const audit=reconcilePaidSeats(parsed,rows);
 if(audit.replayed){
  if(reservation.status!=='PAID')fail('REPLAY_RESERVATION_NOT_PAID');
  return {replayed:true,orderId:parsed.orderId,seatCount:parsed.seats.length,operations:[]};
 }
 if(!audit.ready)fail('SEAT_RECONCILIATION_FAILED');
 if(rows.some(r=>r.hold_id!==reservation.id))fail('HOLD_OWNERSHIP_MISMATCH');
 if(rows.some(r=>typeof r.hold_expires_at!=='string'||!Number.isFinite(Date.parse(r.hold_expires_at))))fail('HOLD_EXPIRY_MISSING');
 const bySku=new Map(rows.map(r=>[r.sku,r]));
 const variants=new Set();
 const operations=parsed.seats.map(s=>{
  const r=bySku.get(s.sku);
  if(!r||!SKU.test(r.sku)||!VARIANT.test(r.shopify_variant_id??''))fail('INVALID_SEAT_MAPPING');
  if(variants.has(r.shopify_variant_id))fail('DUPLICATE_SHOPIFY_VARIANT');
  variants.add(r.shopify_variant_id);
  return {sql:UPDATE,params:[parsed.orderId,r.sku,reservation.id,r.shopify_variant_id],expectedChanges:1};
 });
 return {replayed:false,orderId:parsed.orderId,seatCount:operations.length,operations};
}
/** D1.batch must be transactional; a CHECK(valid=1) guard forces rollback on failed UPDATE. */
export async function executeFulfillment(db,plan,{confirmedOwnership=false}={}){
 if(confirmedOwnership!==true)fail('OWNERSHIP_NOT_VERIFIED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 // Reject untrusted SQL before other plan metadata checks; all metadata guards remain mandatory.
 if(Array.isArray(plan?.operations))for(const op of plan.operations){
  if(op?.sql!==UPDATE||op.expectedChanges!==1||!Array.isArray(op.params)||op.params.length!==4)fail('UNTRUSTED_SQL');
 }
 if(!plan||!ORDER.test(String(plan.orderId??''))||!Number.isSafeInteger(plan.seatCount)||plan.seatCount<1||plan.seatCount>8)fail('INVALID_PLAN');
 if(plan.replayed){if(!Array.isArray(plan.operations)||plan.operations.length!==0)fail('INVALID_REPLAY_PLAN');return {ok:true,replayed:true,seatCount:plan.seatCount};}
 if(!Array.isArray(plan.operations)||plan.operations.length!==plan.seatCount)fail('INVALID_PLAN');
 const skus=new Set(),variants=new Set();
 for(const op of plan.operations){
  const [orderId,sku,reservationId,variantId]=op.params;
  if(orderId!==plan.orderId||typeof sku!=='string'||!SKU.test(sku)||typeof reservationId!=='string'||!RESERVATION.test(reservationId)||typeof variantId!=='string'||!VARIANT.test(variantId))fail('INVALID_PLAN_PARAMETERS');
  if(skus.has(sku)||variants.has(variantId))fail('DUPLICATE_PLAN_SEAT_OR_VARIANT');
  skus.add(sku);variants.add(variantId);
 }
 if(new Set(plan.operations.map(x=>x.params[2])).size!==1)fail('MIXED_RESERVATIONS');
 const statements=[db.prepare('DELETE FROM seat_admin_guard WHERE id=1')];
 for(const op of plan.operations){
  statements.push(db.prepare(UPDATE).bind(...op.params));
  statements.push(db.prepare('INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)'));
  statements.push(db.prepare('DELETE FROM seat_admin_guard WHERE id=1'));
 }
 await db.batch(statements);
 return {ok:true,replayed:false,seatCount:plan.seatCount};
}
