import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSeatRefund} from '../src/seat-refund-preview.js';
const sku='WM-ST-105-B-06',variant='gid://shopify/ProductVariant/456';
const order={id:123,line_items:[{id:99,sku,variant_id:456,quantity:1}]};
const refund={refund_line_items:[{line_item_id:99,quantity:1}]};
const rows=[{sku,status:'SOLD',shopify_order_id:'123',shopify_variant_id:variant}];
test('valid refund always requires manual review; no automatic seat release',()=>{
 const p=previewSeatRefund(order,refund,rows);
 assert.equal(p.requiresManualReview,true);assert.equal(p.automaticSeatRelease,false);assert.equal(p.automaticRefund,false);assert.equal(p.mutations,0);
 assert.deepEqual(p.seatSkus,[sku]);assert.deepEqual(p.issues,[]);
});
test('seat assigned to another order is flagged and never released',()=>{
 const p=previewSeatRefund(order,refund,[{...rows[0],shopify_order_id:'999'}]);
 assert.ok(p.issues.some(x=>x.reason==='SALE_OWNERSHIP_MISMATCH'));assert.equal(p.automaticSeatRelease,false);
});
test('unreleased seat is not restored automatically',()=>{
 const p=previewSeatRefund(order,refund,[{...rows[0],status:'UNRELEASED'}]);
 assert.ok(p.issues.some(x=>x.reason==='SALE_OWNERSHIP_MISMATCH'));
});
test('variant mismatch requires review',()=>{
 const p=previewSeatRefund(order,refund,[{...rows[0],shopify_variant_id:'gid://shopify/ProductVariant/999'}]);
 assert.ok(p.issues.some(x=>x.reason==='VARIANT_MISMATCH'));
});
test('duplicate refund lines rejected',()=>assert.throws(()=>previewSeatRefund(order,{refund_line_items:[...refund.refund_line_items,...refund.refund_line_items]},rows),/DUPLICATE_REFUND_SEAT/));
test('refund quantity over one rejected',()=>assert.throws(()=>previewSeatRefund(order,{refund_line_items:[{line_item_id:99,quantity:2}]},rows),/INVALID_REFUND_QUANTITY/));
test('non-seat merchandise refund ignored',()=>{
 const p=previewSeatRefund(order,{refund_line_items:[{line_item_id:777,quantity:1}]},rows);
 assert.equal(p.ignored,true);assert.equal(p.requiresManualReview,false);
});
test('input objects remain unchanged',()=>{
 const o=structuredClone(order),r=structuredClone(refund),s=structuredClone(rows);
 previewSeatRefund(order,refund,rows);assert.deepEqual(order,o);assert.deepEqual(refund,r);assert.deepEqual(rows,s);
});
