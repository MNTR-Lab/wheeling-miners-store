/** V59: parameterized D1 reservation transaction planner. No network or DB writes.
 * The plan is for future guarded execution, NOT a public checkout endpoint.
 */
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
export function planSeatHold({skus,now,ttlSeconds=600,reservationId=randomUUID()}={}){
 if(!Array.isArray(skus)||skus.length<1||skus.length>8||skus.some(x=>typeof x!=='string'||!SKU.test(x))||new Set(skus).size!==skus.length)throw Error('Invalid or duplicate seat SKUs');
 if(!Number.isSafeInteger(now)||now<1||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>900)throw Error('Invalid time or TTL');
 if(typeof reservationId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(reservationId))throw Error('Invalid reservation ID');
 const expiresAt=now+ttlSeconds;
 if(!Number.isSafeInteger(expiresAt))throw Error('Expiry overflow');
 const steps=[{sql:'INSERT INTO reservations(id,status,created_at,expires_at) VALUES(?,\'HELD\',?,?)',params:[reservationId,now,expiresAt]}];
 for(const sku of skus){
  steps.push({sql:`UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at<=?))`,params:[reservationId,expiresAt,sku,now],requiredChanges:1});
  steps.push({sql:'INSERT INTO reservation_seats(reservation_id,seat_sku) VALUES(?,?)',params:[reservationId,sku]});
 }
 return {version:'V59',mode:'OFFLINE_PLAN_ONLY',sales_enabled:false,checkout_enabled:false,requires_atomic_transaction:true,requires_rowcount_guards:true,steps,seatCount:skus.length,reservationId,expiresAt,warning:'DO NOT run these statements individually. D1 batch alone does not enforce requiredChanges. A transaction with abort-on-mismatch semantics and separate approval is required.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length<3)throw Error('Usage: node tools/plan-d1-seat-holds.mjs SKU [SKU...]');console.log(JSON.stringify(planSeatHold({skus:process.argv.slice(2),now:Math.floor(Date.now()/1000)}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
