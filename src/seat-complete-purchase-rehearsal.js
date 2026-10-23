/** V125: offline checkout-to-payment contract verification.
 * Uses real reservation, checkout, and paid-commit planners.
 * Never calls Shopify, writes D1, or enables public checkout.
 */
import {rehearseSeatCheckout} from './seat-checkout-rehearsal.js';
import {preparePaidCommit} from './seat-paid-commit.js';
const fail=code=>{throw Error(code)};
export function rehearseCompleteSeatPurchase(skus,availableRows,{reservationId,checkoutNonce,expiresAt,orderId='123456789',now=new Date()}={}){
 if(!/^[1-9]\d*$/.test(String(orderId)))fail('INVALID_TEST_ORDER');
 const planned=rehearseSeatCheckout(skus,availableRows,{reservationId,checkoutNonce,expiresAt,now});
 const {checkout,reservationPlan}=planned;
 const reservation={id:reservationId,status:'CHECKOUT_PENDING',checkout_nonce:checkoutNonce,expires_at:checkout.expiresAt,shopify_order_id:null};
 const linked=checkout.lines.map(line=>({seat_sku:line.sku,shopify_variant_id:line.merchandiseId}));
 const held=checkout.lines.map(line=>({sku:line.sku,status:'HELD',hold_id:reservationId,hold_expires_at:checkout.expiresAt,shopify_order_id:null,shopify_variant_id:line.merchandiseId}));
 const order={id:Number(orderId),line_items:checkout.lines.map((line,i)=>({id:i+1,sku:line.sku,variant_id:Number(line.variantId),quantity:1})),note_attributes:checkout.noteAttributes};
 if(!Number.isSafeInteger(order.id)||order.line_items.some(x=>!Number.isSafeInteger(x.variant_id)))fail('INVALID_TEST_ORDER');
 const commit=preparePaidCommit(order,reservation,linked,held,{now});
 if(commit.replayed||commit.seatCount!==checkout.seatCount||commit.operations.length!==checkout.seatCount)fail('REHEARSAL_COMMIT_MISMATCH');
 const checkoutSkus=new Set(checkout.lines.map(x=>x.sku));
 if(commit.operations.some(x=>!checkoutSkus.has(x.params[1])||x.params[2]!==reservationId||String(x.params[0])!==String(orderId)))fail('REHEARSAL_OWNERSHIP_MISMATCH');
 return {mode:'OFFLINE_PURCHASE_REHEARSAL',reservationId,seatCount:checkout.seatCount,totalCents:reservationPlan.totalCents,
  checkoutLineCount:checkout.lines.length,paidCommitOperations:commit.operations.length,
  reservationLinkageVerified:true,variantMappingVerified:true,seatOwnershipVerified:true,
  checkoutEnabled:false,salesEnabled:false,authorizationGranted:false,
  databaseMutations:0,shopifyMutations:0};
}
