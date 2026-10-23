/** V128: final controlled-launch readiness assessment.
 * Pure report aggregation. No D1 writes, Shopify calls, public checkout, or authorization.
 */
const fail=code=>{throw Error(code)};
export function assessControlledLaunch({inventory,checkout,operations={}}={}){
 if(!inventory||inventory.mode!=='READ_ONLY_PREFLIGHT'||!Array.isArray(inventory.issues))fail('INVALID_INVENTORY_REPORT');
 if(!checkout||checkout.mode!=='READ_ONLY_CHECKOUT_HANDOFF'||checkout.checkoutEnabled!==false||
    checkout.salesEnabled!==false||checkout.databaseMutations!==0||checkout.shopifyMutations!==0)fail('INVALID_CHECKOUT_REPORT');
 if(!operations||typeof operations!=='object'||Array.isArray(operations))fail('INVALID_OPERATIONS_REPORT');
 const blockers=[];
 if(!inventory.checksPassed||inventory.issues.length)blockers.push('INVENTORY_PREFLIGHT_NOT_CLEAN');
 if(inventory.salesEnabled!==false||inventory.checkoutEnabled!==false||inventory.databaseMutations!==0||inventory.shopifyMutations!==0)blockers.push('INVENTORY_REPORT_NOT_READ_ONLY');
 if(!checkout.ownershipVerified||!checkout.variantMappingVerified||!Number.isSafeInteger(checkout.seatCount)||checkout.seatCount<1||checkout.seatCount>8)blockers.push('CHECKOUT_HANDOFF_NOT_VERIFIED');
 const required=[
  ['venue_manifest_signed_off','VENUE_APPROVAL_EVIDENCE_MISSING'],
  ['checkout_end_to_end_passed','LIVE_CHECKOUT_NOT_TESTED'],
  ['payment_webhook_reconciled','PAID_WEBHOOK_NOT_RECONCILED'],
  ['oversell_prevention_verified','OVERSELL_PREVENTION_NOT_VERIFIED'],
  ['refund_cancellation_tested','REFUND_CANCELLATION_NOT_TESTED']
 ];
 for(const [key,code] of required)if(operations[key]!==true)blockers.push(code);
 return {version:'V128',mode:'CONTROLLED_LAUNCH_ASSESSMENT_ONLY',
  technicalChecksComplete:blockers.length===0,blockers,
  nextAction:blockers.length?'COMPLETE_CONTROLLED_INTEGRATION_AND_SIGNOFF':'REQUEST_SEPARATE_EXPLICIT_LAUNCH_APPROVAL',
  salesEnabled:false,checkoutEnabled:false,authorizationGranted:false,readyForPublicSales:false,
  databaseMutations:0,shopifyMutations:0};
}
