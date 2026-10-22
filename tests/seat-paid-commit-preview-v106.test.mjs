import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPaidCommit} from '../src/seat-paid-commit-preview.js';
const rid='reservation_123456789',nonce='nonce_1234567890123456789012';
const sku='WM-ST-105-B-06',variant='gid://shopify/ProductVariant/456';
const order={id:123,line_items:[{sku,variant_id:456,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
const reservation={id:rid,checkout_nonce:nonce,status:'HELD',expires_at:'2099-01-01T00:00:00.000Z',shopify_order_id:null};
const seat={sku,status:'HELD',hold_id:rid,hold_expires_at:reservation.expires_at,shopify_order_id:null,shopify_variant_id:variant};
function fake({r=reservation,linked=[{seat_sku:sku,shopify_variant_id:variant}],seats=[seat]}={}){
 const sql=[];
 return {sql,prepare(s){sql.push(s);if(!/^SELECT /i.test(s))throw Error('WRITE_ATTEMPTED');return {bind(){return {first:async()=>r,all:async()=>({results:s.includes('reservation_seats')?linked:seats})}}}}};
}
test('prepares paid transaction without any database write',async()=>{const db=fake();const p=await previewPaidCommit(order,db);assert.equal(p.reason,'PAID_COMMIT_PREPARED');assert.equal(p.ownership_verified,true);assert.equal(p.proposed_seat_updates,1);assert.equal(p.proposed_reservation_updates,1);assert.equal(p.fulfillment_enabled,false);assert.ok(db.sql.every(s=>/^SELECT /i.test(s)));});
test('ignores unrelated orders',async()=>{const p=await previewPaidCommit({id:123,line_items:[{sku:'SHIRT',quantity:1}]},fake());assert.equal(p.ignored,true)});
test('rejects missing reservation link before querying',async()=>{const db=fake();const p=await previewPaidCommit({...order,note_attributes:[]},db);assert.equal(p.reason,'INVALID_RESERVATION_LINK');assert.equal(db.sql.length,0)});
test('rejects missing reservation',async()=>{assert.equal((await previewPaidCommit(order,fake({r:null}))).reason,'RESERVATION_NOT_FOUND')});
test('rejects missing linked seats',async()=>{assert.equal((await previewPaidCommit(order,fake({linked:[]}))).reason,'RESERVATION_SEAT_COUNT_MISMATCH')});
test('rejects unavailable held seat',async()=>{const p=await previewPaidCommit(order,fake({seats:[{...seat,status:'AVAILABLE'}]}));assert.equal(p.reason,'PAID_COMMIT_REJECTED')});
test('rejects wrong nonce',async()=>{const p=await previewPaidCommit({...order,note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:'wrong'}]},fake());assert.equal(p.detail,'CHECKOUT_NONCE_MISMATCH')});
test('rejects duplicate reservation link',async()=>{const db=fake();const p=await previewPaidCommit({...order,note_attributes:[...order.note_attributes,order.note_attributes[0]]},db);assert.equal(p.reason,'INVALID_RESERVATION_LINK');assert.equal(db.sql.length,0)});
