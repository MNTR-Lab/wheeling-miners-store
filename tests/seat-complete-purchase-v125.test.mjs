import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseCompleteSeatPurchase} from '../src/seat-complete-purchase-rehearsal.js';
const reservationId='reservation_123456789012',checkoutNonce='nonce_123456789012345678901234';
const now=new Date('2026-10-22T00:00:00Z'),expiresAt=Date.parse('2026-10-22T00:15:00Z');
const seat=n=>({sku:`WM-ST-105-B-${String(n).padStart(2,'0')}`,status:'AVAILABLE',hold_id:null,shopify_order_id:null,shopify_variant_id:`gid://shopify/ProductVariant/${n}`,price_cents:16000});
const rows=[seat(1),seat(2),seat(3)];
const run=(selection=rows.slice(0,2).map(x=>x.sku),records=rows,options={})=>rehearseCompleteSeatPurchase(selection,records,{reservationId,checkoutNonce,expiresAt,now,...options});
test('two-seat selection flows through reservation, checkout payload, and paid commit',()=>{
 const result=run();assert.equal(result.seatCount,2);assert.equal(result.checkoutLineCount,2);
 assert.equal(result.paidCommitOperations,2);assert.equal(result.totalCents,32000);
 assert.equal(result.reservationLinkageVerified,true);assert.equal(result.seatOwnershipVerified,true);
});
test('one-seat flow preserves one-to-one ownership',()=>assert.equal(run([rows[0].sku]).paidCommitOperations,1));
test('three-seat flow preserves three separate Shopify variants',()=>assert.equal(run(rows.map(x=>x.sku)).paidCommitOperations,3));
test('rehearsal cannot enable checkout or change production',()=>{
 const r=run();assert.equal(r.checkoutEnabled,false);assert.equal(r.salesEnabled,false);
 assert.equal(r.databaseMutations,0);assert.equal(r.shopifyMutations,0);
});
test('unreleased inventory blocks the complete flow',()=>assert.throws(()=>run([rows[0].sku],[{...rows[0],status:'UNRELEASED'}]),/SEATS_NOT_AVAILABLE/));
test('already claimed inventory blocks the complete flow',()=>assert.throws(()=>run([rows[0].sku],[{...rows[0],status:'SOLD',shopify_order_id:'123'}]),/SEATS_NOT_AVAILABLE/));
test('duplicate seat selection blocks the complete flow',()=>assert.throws(()=>run([rows[0].sku,rows[0].sku]),/DUPLICATE_SKU/));
test('expired reservation blocks the complete flow',()=>assert.throws(()=>run(undefined,rows,{expiresAt:Date.parse('2026-10-21T00:00:00Z')}),/INVALID_EXPIRATION/));
test('bad test order ID is rejected',()=>assert.throws(()=>run(undefined,rows,{orderId:'0'}),/INVALID_TEST_ORDER/));
test('input inventory remains untouched',()=>{const copy=structuredClone(rows);run();assert.deepEqual(rows,copy)});
