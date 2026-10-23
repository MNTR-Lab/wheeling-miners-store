import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePaidCommit,executePaidCommit} from '../src/seat-paid-commit.js';
const rid='reservation_123456789',nonce='nonce_1234567890123456789012';
const sku='WM-ST-105-B-06',variant='gid://shopify/ProductVariant/456';
const reservation={id:rid,checkout_nonce:nonce,status:'HELD',expires_at:Date.parse('2099-01-01T00:00:00.000Z'),shopify_order_id:null};
const linked=[{sku,shopify_variant_id:variant}];
const rows=[{sku,status:'HELD',hold_id:rid,hold_expires_at:reservation.expires_at,shopify_order_id:null,shopify_variant_id:variant}];
const order={id:123,line_items:[{sku,variant_id:456,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
const plan=()=>preparePaidCommit(order,reservation,linked,rows);
function db(){const sql=[];return {sql,prepare(s){sql.push(s);return {bind(...params){return {sql:s,params}}}},async batch(stmts){this.statements=stmts;return []}}}
test('verified paid order creates one seat and one reservation update',()=>{const p=plan();assert.equal(p.seatCount,1);assert.equal(p.reservationId,rid);assert.equal(p.operations.length,1)});
test('rejects wrong checkout nonce',()=>assert.throws(()=>preparePaidCommit({...order,note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:'wrong'}]},reservation,linked,rows),/CHECKOUT_NONCE_MISMATCH/));
test('rejects wrong seat mapping',()=>assert.throws(()=>preparePaidCommit(order,reservation,[{sku,shopify_variant_id:'gid://shopify/ProductVariant/999'}],rows),/RESERVATION_SEAT_MISMATCH/));
test('requires signature authorization',async()=>await assert.rejects(executePaidCommit(db(),plan()),/SIGNATURE_NOT_VERIFIED/));
test('atomic batch includes guarded CONFIRMED reservation update after seat update',async()=>{const d=db();await executePaidCommit(d,plan(),{signatureVerified:true});assert.equal(d.statements.length,7);assert.match(d.sql[4],/UPDATE reservations SET status='CONFIRMED'/);assert.match(d.sql[5],/CASE WHEN changes\(\)=1/)});
test('rejects modified SQL',async()=>{const p=plan();p.operations[0].sql='DELETE FROM seats';const d=db();await assert.rejects(executePaidCommit(d,p,{signatureVerified:true}),/UNTRUSTED_PLAN/);assert.equal(d.statements,undefined)});
test('rejects mismatched reservation in update',async()=>{const p=plan();p.operations[0].params[2]='other_reservation_123456';await assert.rejects(executePaidCommit(db(),p,{signatureVerified:true}),/INVALID_PLAN/)});
test('rejects missing database',async()=>await assert.rejects(executePaidCommit(null,plan(),{signatureVerified:true}),/DATABASE_UNAVAILABLE/));
