/** V119: read-only expiry audit. Never releases a seat or changes a reservation.
 * Checkout-pending holds are excluded: a payment may still be processing.
 */
import {expiryMilliseconds} from './seat-expiry.js';
const fail=code=>{throw Error(code)};
const SQL=`SELECT s.sku,s.hold_id,s.hold_expires_at,r.status AS reservation_status
FROM seats s JOIN reservations r ON r.id=s.hold_id
WHERE s.status='HELD' AND s.shopify_order_id IS NULL
 AND s.hold_id IS NOT NULL AND s.hold_expires_at IS NOT NULL
 AND s.hold_expires_at<? AND r.expires_at<?
 AND r.status='HELD' AND r.shopify_order_id IS NULL
 ORDER BY s.hold_expires_at,s.sku LIMIT ?`;
export function planExpiryAudit({now=new Date(),limit=100}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)fail('INVALID_LIMIT');
 return {sql:SQL,params:[now.valueOf(),now.valueOf(),limit],mode:'READ_ONLY',mutations:0};
}
export async function inspectExpiredHolds(db,{now=new Date(),limit=100}={}){
 if(!db?.prepare)fail('DATABASE_UNAVAILABLE');
 const plan=planExpiryAudit({now,limit});
 const result=await db.prepare(plan.sql).bind(...plan.params).all();
 if(!Array.isArray(result?.results))fail('DATABASE_RESULT_INVALID');
 const seats=[],seen=new Set();
 for(const row of result.results){
  if(!row||typeof row.sku!=='string'||seen.has(row.sku)||row.reservation_status!=='HELD'||typeof row.hold_id!=='string')fail('DATABASE_RESULT_INVALID');
  let expiry;try{expiry=expiryMilliseconds(row.hold_expires_at)}catch{fail('DATABASE_RESULT_INVALID')}
  if(expiry>=now.valueOf())fail('DATABASE_RESULT_INVALID');
  seen.add(row.sku);seats.push({sku:row.sku,reservationId:row.hold_id,expiresAt:expiry});
 }
 if(seats.length>limit)fail('DATABASE_RESULT_INVALID');
 return {mode:'READ_ONLY',mutations:0,automaticReleaseEnabled:false,eligibleForReview:seats.length,seats};
}
