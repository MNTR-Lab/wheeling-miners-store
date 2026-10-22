import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSeatReleaseGate} from '../tools/seat-release-gate.mjs';
const good={
 manifest:{version:'V53',mode:'OFFLINE_READ_ONLY',issue_count:0,manifest_matches_staging:true,ready_for_sales:false,shopify_mutations:0,d1_mutations:0},
 shopify:{version:'V52',mode:'READ_ONLY',issue_count:0,ready_for_sales:false,sales_enabled:false,shopify_mutations:0,d1_mutations:0},
 mapping:{mode:'READ_ONLY',issue_count:0,approved_for_release:false},
 operations:{venue_manifest_signed_off:true,checkout_end_to_end_passed:true,payment_webhook_reconciled:true,oversell_prevention_verified:true,refund_cancellation_tested:true}
};
test('missing reports fail closed',()=>{const x=evaluateSeatReleaseGate();assert.ok(x.blockers.length>=3);assert.equal(x.sales_enabled,false)});
test('even completed checklist never authorizes sales',()=>{const x=evaluateSeatReleaseGate(good);assert.equal(x.checklist_complete,true);assert.equal(x.authorization_granted,false);assert.equal(x.ready_for_sales,false)});
test('manifest mismatch blocks',()=>assert.ok(evaluateSeatReleaseGate({...good,manifest:{...good.manifest,issue_count:1}}).blockers.length));
test('Shopify mismatch blocks',()=>assert.ok(evaluateSeatReleaseGate({...good,shopify:{...good.shopify,issue_count:1}}).blockers.length));
test('mapping audit must be read-only',()=>assert.ok(evaluateSeatReleaseGate({...good,mapping:{...good.mapping,mode:'WRITE'}}).blockers.length));
for(const key of Object.keys(good.operations))test('missing '+key+' blocks',()=>{const operations={...good.operations,[key]:false};assert.ok(evaluateSeatReleaseGate({...good,operations}).blockers.length)});
test('report never mutates or grants approval',()=>{const x=evaluateSeatReleaseGate(good);assert.equal(x.shopify_mutations,0);assert.equal(x.d1_mutations,0);assert.equal(x.authorization_granted,false)});
for(const key of ['mode','ready_for_sales','shopify_mutations','d1_mutations'])test('manifest missing '+key+' fails closed',()=>{const manifest={...good.manifest};delete manifest[key];assert.equal(evaluateSeatReleaseGate({...good,manifest}).checklist_complete,false)});
for(const key of ['mode','ready_for_sales','sales_enabled','shopify_mutations','d1_mutations'])test('Shopify missing '+key+' fails closed',()=>{const shopify={...good.shopify};delete shopify[key];assert.equal(evaluateSeatReleaseGate({...good,shopify}).checklist_complete,false)});
test('mapping missing explicit nonapproval fails closed',()=>{const mapping={...good.mapping};delete mapping.approved_for_release;assert.equal(evaluateSeatReleaseGate({...good,mapping}).checklist_complete,false)});
