import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCheckoutOwnership} from '../src/seat-checkout-linkage.js';
import {preparePaidCommit,executePaidCommit} from '../src/seat-paid-commit.js';
import {parsePaidSeatOrder} from '../src/seat-paid-order.js';

const rid='wm_security_reservation_2026';
const nonce='wm_security_checkout_nonce_2026';
const sku='WM-ST-105-B-01';
const variant='gid://shopify/ProductVariant/50931850575929';
const orderId='18969898221625';
const expiry=Date.now()+600000;
const reservation=()=>({id:rid,status:'CHECKOUT_PENDING',checkout_nonce:nonce,expires_at:expiry,shopify_order_id:null});
const order=()=>({id:orderId,line_items:[{sku,variant_id:'50931850575929',quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]});
const linked=()=>[{sku,shopify_variant_id:variant}];
const rows=()=>[{sku,status:'HELD',hold_id:rid,hold_expires_at:expiry,shopify_variant_id:variant,shopify_order_id:null}];
const check=(o=order(),r=reservation(),l=linked())=>verifyCheckoutOwnership(o,r,l);
const plan=(o=order(),r=reservation(),l=linked(),s=rows())=>preparePaidCommit(o,r,l,s);

test('valid paid seat has a guarded transaction plan',()=>{
 assert.equal(check().confirmedOwnership,true);
 const p=plan();assert.equal(p.replayed,false);assert.equal(p.operations.length,1);
 assert.match(p.operations[0].sql,/status='HELD'/);
});
test('expired unconfirmed reservation fails closed',()=>{
 const r=reservation();r.expires_at=Date.now()-1000;
 assert.throws(()=>check(order(),r),/EXPIRED_RESERVATION/);
 assert.throws(()=>plan(order(),r),/EXPIRED_RESERVATION/);
});
test('invalid and duplicate checkout attributes fail closed',()=>{
 const o=order();o.note_attributes[1].value='different_nonce_123456789012345';
 assert.throws(()=>check(o),/CHECKOUT_NONCE_MISMATCH/);
 const dup=order();dup.note_attributes.push({...dup.note_attributes[1]});
 assert.throws(()=>check(dup),/DUPLICATE_CHECKOUT_ATTRIBUTE/);
});
test('mismatched variant and seat mapping fail closed',()=>{
 const o=order();o.line_items[0].variant_id='50931850575930';
 assert.throws(()=>check(o),/RESERVATION_SEAT_MISMATCH/);
 assert.throws(()=>plan(o),/RESERVATION_SEAT_MISMATCH/);
});
test('seat claimed by another order cannot be fulfilled',()=>{
 const s=rows();s[0].status='SOLD';s[0].shopify_order_id='18969898221626';s[0].hold_id=null;
 assert.throws(()=>plan(order(),reservation(),linked(),s),/SEAT_RECONCILIATION_FAILED/);
});
test('expired confirmed reservation permits only exact same-order replay',()=>{
 const r=reservation();r.status='CONFIRMED';r.shopify_order_id=orderId;r.expires_at=Date.now()-1000;
 const s=rows();s[0].status='SOLD';s[0].shopify_order_id=orderId;s[0].hold_id=null;
 const p=plan(order(),r,linked(),s);assert.equal(p.replayed,true);assert.deepEqual(p.operations,[]);
 const different=order();different.id='18969898221626';
 assert.throws(()=>plan(different,r,linked(),s),/ORDER_MISMATCH/);
});
test('replay never writes and requires verified signature',async()=>{
 const r=reservation();r.status='CONFIRMED';r.shopify_order_id=orderId;
 const s=rows();s[0].status='SOLD';s[0].shopify_order_id=orderId;s[0].hold_id=null;
 const p=plan(order(),r,linked(),s);
 let calls=0;const db={prepare(){calls++;throw Error('Unexpected database write')},batch(){calls++;throw Error('Unexpected database batch')}};
 await assert.rejects(executePaidCommit(db,p),/SIGNATURE_NOT_VERIFIED/);
 const result=await executePaidCommit(db,p,{signatureVerified:true});
 assert.equal(result.replayed,true);assert.equal(calls,0);
});
test('duplicate seat SKU, quantity >1 and invalid order are rejected',()=>{
 const dup=order();dup.line_items.push({...dup.line_items[0]});
 assert.throws(()=>parsePaidSeatOrder(dup),/DUPLICATE_SEAT_SKU/);
 const quantity=order();quantity.line_items[0].quantity=2;
 assert.throws(()=>parsePaidSeatOrder(quantity),/INVALID_LINE_ITEM/);
 const invalid=order();invalid.id='0';
 assert.throws(()=>parsePaidSeatOrder(invalid),/INVALID_ORDER/);
});
test('paid plan refuses untrusted SQL or inconsistent parameters before D1 write',async()=>{
 const p=plan();p.operations[0].sql='DELETE FROM seats';
 let calls=0;const db={prepare(){calls++;throw Error('Unexpected write')},batch(){calls++;throw Error('Unexpected batch')}};
 await assert.rejects(executePaidCommit(db,p,{signatureVerified:true}),/UNTRUSTED_PLAN/);
 assert.equal(calls,0);
});
