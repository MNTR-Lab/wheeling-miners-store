/** Reclaim abandoned public holds only after a 15-minute webhook grace period.
 * A delayed paid order that no longer owns its seats stays in reconciliation.
 * Never changes Shopify stock, sold seats, or TEST data.
 */
import {publicSalesEnabled} from './seat-public-checkout.js';
export async function releaseExpiredPublicHolds(env,{now=Date.now()}={}){
 if(!publicSalesEnabled(env)||!env.SEAT_DB?.batch||!Number.isSafeInteger(now))return {enabled:false};
 const cutoff=now-15*60*1000;
 await env.SEAT_DB.batch([
  env.SEAT_DB.prepare("UPDATE reservations SET status='EXPIRED' WHERE id GLOB 'wm_pub_*' AND status IN ('HELD','CHECKOUT_PENDING') AND expires_at<? AND shopify_order_id IS NULL").bind(cutoff),
  env.SEAT_DB.prepare("UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='HELD' AND shopify_order_id IS NULL AND hold_expires_at<? AND hold_id IN (SELECT id FROM reservations WHERE id GLOB 'wm_pub_*' AND status='EXPIRED' AND shopify_order_id IS NULL AND expires_at<?)").bind(cutoff,cutoff)
 ]);
 return {enabled:true};
}
