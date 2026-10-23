import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseSeatCheckout} from '../src/seat-checkout-rehearsal.js';
const rid='reservation_123456789012',nonce='nonce_123456789012345678901234';
const expires=Date.parse('2099-10-22T20:00:00Z');
const seat=n=>({sku:`WM-ST-105-B-${String(n).padStart(2,'0')}`,status:'AVAILABLE',hold_id:null,shopify_order_id:null,shopify_variant_id:`gid://shopify/ProductVariant/${n}`,price_cents:16000});
const rows=[seat(1),seat(2)];
const run=(selection=rows.map(s=>s.sku),data=rows)=>rehearseSeatCheckout(selection,data,{reservationId:rid,checkoutNonce:nonce,expiresAt:expires});
test('end-to-end rehearsal matches reservation and Shopify checkout payload',()=>{
 const r=run();assert.equal(r.reservationPlan.seatCount,2);assert.equal(r.checkout.seatCount,2);
 assert.deepEqual(r.checkout.lines.map(x=>x.variantId),['1','2']);
 assert.equal(r.reservationPlan.expiresAt,r.checkout.expiresAt);
 assert.equal(r.reservationPlan.totalCents,32000);
 assert.deepEqual(r.checkout.noteAttributes.map(x=>x.value),[rid,nonce]);
 assert.ok(Object.values(r.checks).every(Boolean));
});
test('rehearsal never enables checkout, holds, or mutates either service',()=>{
 const r=run();assert.equal(r.mode,'OFFLINE_REHEARSAL_ONLY');
 assert.equal(r.salesEnabled,false);assert.equal(r.checkoutEnabled,false);assert.equal(r.holdsEnabled,false);
 assert.equal(r.databaseMutations,0);assert.equal(r.shopifyMutations,0);
});
test('unreleased seats rejected before generating checkout',()=>assert.throws(()=>run([rows[0].sku],[{...rows[0],status:'UNRELEASED'}]),/SEATS_NOT_AVAILABLE/));
test('missing mapping rejected',()=>assert.throws(()=>run([rows[0].sku],[{...rows[0],shopify_variant_id:null}]),/INVALID_VARIANT_MAPPING|SEATS_NOT_AVAILABLE/));
test('duplicate seats rejected',()=>assert.throws(()=>run([rows[0].sku,rows[0].sku],rows),/DUPLICATE_SKU/));
test('expired reservations rejected',()=>assert.throws(()=>rehearseSeatCheckout([rows[0].sku],[rows[0]],{reservationId:rid,checkoutNonce:nonce,expiresAt:Date.parse('2020-01-01T00:00:00Z')}),/INVALID_EXPIRATION/));
test('rehearsal does not mutate supplied seat records',()=>{const copy=structuredClone(rows);run();assert.deepEqual(rows,copy)});
