/** V127: read-only preflight for Shopify checkout handoff.
 * Evaluates server-generated reservation/checkout payload against D1 snapshots.
 * No Shopify calls, database writes, or public route enablement.
 */
import {buildShopifySeatCheckout} from './seat-shopify-checkout-payload.js';
const fail=code=>{throw Error(code)};
export function verifyCheckoutHandoff(reservation,linkedSeats,seatRows,{now=new Date()}={}){
 const checkout=buildShopifySeatCheckout(reservation,linkedSeats,{now});
 if(!Array.isArray(seatRows)||seatRows.length!==checkout.seatCount)fail('SEAT_SNAPSHOT_MISMATCH');
 const bySku=new Map();
 for(const row of seatRows){
  if(!row||typeof row.sku!=='string'||bySku.has(row.sku))fail('DUPLICATE_OR_INVALID_SEAT_SNAPSHOT');
  bySku.set(row.sku,row);
 }
 for(const line of checkout.lines){
  const row=bySku.get(line.sku);
  if(!row)fail('SEAT_SNAPSHOT_MISMATCH');
  if(row.status!=='HELD'||row.hold_id!==reservation.id||row.shopify_order_id!=null)fail('SEAT_NOT_HELD_BY_RESERVATION');
  if(row.shopify_variant_id!==line.merchandiseId)fail('SHOPIFY_VARIANT_MISMATCH');
  if(row.hold_expires_at!==checkout.expiresAt)fail('SEAT_EXPIRY_MISMATCH');
 }
 if(new Set(checkout.lines.map(line=>line.variantId)).size!==checkout.seatCount)fail('DUPLICATE_VARIANTS');
 return {mode:'READ_ONLY_CHECKOUT_HANDOFF',reservationId:checkout.reservationId,seatCount:checkout.seatCount,
  lineItems:checkout.lines.map(line=>({merchandiseId:line.merchandiseId,quantity:1,sku:line.sku})),
  noteAttributes:checkout.noteAttributes,expiresAt:checkout.expiresAt,
  ownershipVerified:true,variantMappingVerified:true,
  readyForLiveCheckout:false,checkoutEnabled:false,salesEnabled:false,authorizationGranted:false,
  databaseMutations:0,shopifyMutations:0};
}
