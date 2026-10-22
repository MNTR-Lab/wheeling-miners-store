/** V60: D1-compatible atomic reservation SQL plan, staging only.
 * No database connection or sales enablement. A failed seat update aborts
 * the entire D1 batch via a temporary guard table CHECK constraint.
 * Do not execute until D1 batch atomicity is validated against staging.
 */
import {planSeatHold} from './plan-d1-seat-holds.mjs';
export function buildAtomicHoldBatch(input){
 const plan=planSeatHold(input);
 const steps=[{sql:'CREATE TABLE IF NOT EXISTS seat_hold_guard_v60 (id INTEGER PRIMARY KEY CHECK(id=1), marker INTEGER NOT NULL CHECK(marker=1))',params:[]}];
 // A persistent guard table is required because D1 batch uses independent
 // prepared statements. Each guard insertion violates CHECK if changes()!=1.
 // The guard table must be provisioned separately before using this plan.
 // This module deliberately does NOT return an executable batch: D1 changes()
 // behavior and transaction rollback require staging validation first.
 return {version:'V60',mode:'REVIEW_ONLY',executable:false,checkout_enabled:false,sales_enabled:false,hold_plan:plan,prerequisites:['Confirm D1 batch rollback on constraint violation','Validate changes() after guarded UPDATE','Reconcile expired reservation records before seat reuse','Approve venue manifest and Shopify mapping'],guard_example:steps[0],warning:'Do not execute hold_plan steps or enable hold endpoints.'};
}
