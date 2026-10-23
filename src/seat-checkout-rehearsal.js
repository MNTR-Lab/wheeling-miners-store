/** V120: offline reservation-to-Shopify checkout rehearsal.
 * Pure planning only; never reserves seats, enables checkout, or contacts Shopify.
 */
import {prepareReservationTransaction} from './seat-reservation-transaction.js';
import {buildShopifySeatCheckout} from './seat-shopify-checkout-payload.js';
const fail=code=>{throw Error(code)};
export function rehearseSeatCheckout(skus,rows,{reservationId,checkoutNonce,expiresAt,now=new Date()}={}){
 const reservationPlan=prepareReservationTransaction(skus,rows,{reservationId,checkoutNonce,expiresAt,now});
 const reservation={id:reservationPlan.reservationId,checkout_nonce:reservationPlan.checkoutNonce,status:'HELD',expires_at:reservationPlan.expiresAt,shopify_order_id:null};
 const linked=reservationPlan.seats.map(s=>({seat_sku:s.sku,shopify_variant_id:s.variantId}));
 const checkout=buildShopifySeatCheckout(reservation,linked,{now});
 if(checkout.seatCount!==reservationPlan.seatCount)fail('REHEARSAL_SEAT_COUNT_MISMATCH');
 const planned=new Map(reservationPlan.seats.map(s=>[s.sku,s.variantId]));
 if(planned.size!==checkout.lines.length||checkout.lines.some(line=>planned.get(line.sku)!==line.merchandiseId||line.quantity!==1))fail('REHEARSAL_MAPPING_MISMATCH');
 return {
  mode:'OFFLINE_REHEARSAL_ONLY',salesEnabled:false,checkoutEnabled:false,holdsEnabled:false,
  databaseMutations:0,shopifyMutations:0,
  reservationPlan,checkout,
  checks:{seatCountMatched:true,variantsMatched:true,expiryMatched:reservationPlan.expiresAt===checkout.expiresAt,
   checkoutAttributesPresent:checkout.noteAttributes.length===2}
 };
}
