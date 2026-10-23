import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCheckoutHandoff} from '../src/seat-checkout-handoff.js';
const now=new Date('2026-10-22T00:00:00Z'),expiry=Date.parse('2026-10-22T00:15:00Z');
const reservation={id:'reservation_123456789012',checkout_nonce:'nonce_123456789012345678901234',status:'HELD',expires_at:expiry,shopify_order_id:null};
const linked=[{seat_sku:'WM-ST-105-B-01',shopify_variant_id:'gid://shopify/ProductVariant/1001'},{seat_sku:'WM-ST-105-B-02',shopify_variant_id:'gid://shopify/ProductVariant/1002'}];
const seats=linked.map(x=>({sku:x.seat_sku,status:'HELD',hold_id:reservation.id,hold_expires_at:expiry,shopify_variant_id:x.shopify_variant_id,shopify_order_id:null}));
const run=(r=reservation,l=linked,s=seats)=>verifyCheckoutHandoff(r,l,s,{now});
test('two reserved seats produce verified Shopify handoff payload',()=>{
 const result=run();assert.equal(result.seatCount,2);assert.equal(result.lineItems.length,2);
 assert.equal(result.noteAttributes.length,2);assert.ok(result.ownershipVerified);
});
test('handoff remains strictly read only and never enables checkout',()=>{
 const result=run();assert.equal(result.readyForLiveCheckout,false);assert.equal(result.checkoutEnabled,false);
 assert.equal(result.databaseMutations,0);assert.equal(result.shopifyMutations,0);
});
test('wrong reservation hold is rejected',()=>assert.throws(()=>run(reservation,linked,[{...seats[0],hold_id:'another_reservation_12345'},seats[1]]),/SEAT_NOT_HELD_BY_RESERVATION/));
test('sold seat cannot be handed off',()=>assert.throws(()=>run(reservation,linked,[{...seats[0],status:'SOLD'},seats[1]]),/SEAT_NOT_HELD_BY_RESERVATION/));
test('variant mismatch is rejected',()=>assert.throws(()=>run(reservation,linked,[{...seats[0],shopify_variant_id:'gid://shopify/ProductVariant/99'},seats[1]]),/SHOPIFY_VARIANT_MISMATCH/));
test('hold expiry mismatch is rejected',()=>assert.throws(()=>run(reservation,linked,[{...seats[0],hold_expires_at:expiry+1000},seats[1]]),/SEAT_EXPIRY_MISMATCH/));
test('missing seat snapshot is rejected',()=>assert.throws(()=>run(reservation,linked,[seats[0]]),/SEAT_SNAPSHOT_MISMATCH/));
test('duplicate seat snapshot is rejected',()=>assert.throws(()=>run(reservation,linked,[seats[0],seats[0]]),/DUPLICATE_OR_INVALID_SEAT_SNAPSHOT/));
test('expired reservation cannot generate handoff',()=>assert.throws(()=>run({...reservation,expires_at:Date.parse('2026-10-21T00:00:00Z')}),/RESERVATION_EXPIRED/));
test('no input mutation',()=>{const r=structuredClone(reservation),l=structuredClone(linked),s=structuredClone(seats);run();assert.deepEqual(reservation,r);assert.deepEqual(linked,l);assert.deepEqual(seats,s)});
