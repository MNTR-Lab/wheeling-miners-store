/** V83: atomic, fail-closed D1 payment fulfillment. NOT routed or enabled.
 * A trusted caller must independently verify Shopify HMAC AND reservation-to-order
 * ownership before calling. Does not grant authority to create reservations.
 */
import {parsePaidSeatOrder,reconcilePaidSeats} from './seat-paid-order.js';
const RESERVATION=/^[A-Za-z0-9_-]{16,128}$/;
const ORDER=/^\d+$/;
const QMARKS=n=>Array(n).fill('?').join(',');
const fail=(code)=>{throw Error(code)};
export function prepareFulfillment(order, reservation, rows){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)fail('NO_ASSIGNED_SEATS');
 if(!RESERVATION.test(reservation?.id??''))fail('INVALID_RESERVATION_ID');
 if(!ORDER.test(parsed.orderId))fail('INVALID_ORDER_ID');
 if(reservation.shopify_order_id!=null && String(reservation.shopify_order_id)!==parsed.orderId)fail('ORDER_OWNERSHIP_MISMATCH');
 if(!['CHECKOUT_PENDING','HELD','PAID'].includes(reservation.status))fail('RESERVATION_STATE_INVALID');
 if(!Array.isArray(rows)||rows.length!==parsed.seats.length)fail('INCOMPLETE_SEAT_SET');
 const audit=reconcilePaidSeats(parsed,rows);
 if(audit.replayed)return {replayed:true,orderId:parsed.orderId,seatCount:parsed.seats.length,operations:[]};
 if(!audit.ready)fail('SEAT_RECONCILIATION_FAILED');
 if(rows.some(r=>r.hold_id!==reservation.id))fail('HOLD_OWNERSHIP_MISMATCH');
 if(rows.some(r=>r.hold_expires_at==null))fail('HOLD_EXPIRY_MISSING');
 const ordered=parsed.seats.map(s=>rows.find(r=>r.sku===s.sku));
 if(new Set(ordered.map(r=>r.sku)).size!==ordered.length)fail('DUPLICATE_DB_ROW');
 return {replayed:false,orderId:parsed.orderId,seatCount:ordered.length,operations:ordered.map(r=>({
  sql:"UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_order_id IS NULL AND shopify_variant_id=?",
  params:[parsed.orderId,r.sku,reservation.id,r.shopify_variant_id]
 }))};
}
/** Guarded atomic execution. D1.batch() transaction rolls back on any failing guard.
 * The guard table has CHECK(valid=1); changes() must be 1 after every seat UPDATE.
 * Caller must pass a reservation already verified against checkout/order metadata.
 */
export async function executeFulfillment(db,plan,{confirmedOwnership=false}={}){
 if(!confirmedOwnership)fail('OWNERSHIP_NOT_VERIFIED');
 if(!db?.prepare||!db?.batch)fail('DATABASE_UNAVAILABLE');
 if(plan?.replayed)return {ok:true,replayed:true,seatCount:plan.seatCount};
 if(!Array.isArray(plan?.operations)||!plan.operations.length||plan.operations.length>8)fail('INVALID_PLAN');
 const statements=[db.prepare('DELETE FROM seat_admin_guard WHERE id=1')];
 for(const op of plan.operations){
  if(op.sql!=="UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_order_id IS NULL AND shopify_variant_id=?"||op.params?.length!==4)fail('UNTRUSTED_SQL');
  statements.push(db.prepare(op.sql).bind(...op.params));
  statements.push(db.prepare('INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)'));
  statements.push(db.prepare('DELETE FROM seat_admin_guard WHERE id=1'));
 }
 await db.batch(statements);
 return {ok:true,replayed:false,seatCount:plan.seatCount};
}
