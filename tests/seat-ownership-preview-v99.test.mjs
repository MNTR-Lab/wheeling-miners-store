import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSeatAdmin} from '../src/seat-admin.js';
const token='a'.repeat(40),rid='reservation_123456789',sku='WM-ST-105-B-06';
const nonce='nonce_1234567890123456789012';
const variant='gid://shopify/ProductVariant/456';
const order={id:123,line_items:[{sku,quantity:1,variant_id:456}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
const reservation={id:rid,status:'HELD',checkout_nonce:nonce,expires_at:'2099-01-01T00:00:00.000Z',shopify_order_id:null};
const seat={sku,status:'HELD',shopify_variant_id:variant,hold_id:rid,hold_expires_at:'2099-01-01T00:00:00.000Z',shopify_order_id:null};
function setup(){const sql=[];const db={prepare(q){sql.push(q);if(!/^SELECT\s/i.test(q))throw Error('UNEXPECTED_WRITE');return {bind(){return {first:async()=>reservation,all:async()=>({results:q.includes('reservation_seats')?[{seat_sku:sku,shopify_variant_id:variant}]:[seat]})}}}}};return {sql,env:{SEAT_DB:db,SEAT_ADMIN_TOKEN:token}};}
function req(payload=order,authorization=`Bearer ${token}`){return new Request('https://example.com/api/seats/admin/ownership-preview',{method:'POST',headers:{'authorization':authorization,'content-type':'application/json'},body:JSON.stringify(payload)});}
test('valid order gets ownership preview, no payment authority or writes',async()=>{const {sql,env}=setup();const res=await handleSeatAdmin(req(),env);const data=await res.json();assert.equal(res.status,200);assert.equal(data.inspection.reason,'OWNERSHIP_VERIFIED');assert.equal(data.inspection.proposed_seat_updates,1);assert.equal(data.preview_only,true);assert.equal(data.payment_verified,false);assert.equal(data.fulfillment_executed,false);assert.equal(data.sales_enabled,false);assert.ok(sql.length>0);assert.ok(sql.every(x=>/^SELECT\s/i.test(x)));});
test('unauthorized request cannot read reservation',async()=>{const {sql,env}=setup();const res=await handleSeatAdmin(req(order,'Bearer wrong'),env);assert.equal(res.status,401);assert.equal(sql.length,0);});
test('bad checkout nonce rejected without writes',async()=>{const {sql,env}=setup();const payload={...order,note_attributes:[order.note_attributes[0],{name:'wm_checkout_nonce',value:'different_nonce_123456789012345'}]};const data=await (await handleSeatAdmin(req(payload),env)).json();assert.equal(data.inspection.detail,'CHECKOUT_NONCE_MISMATCH');assert.ok(sql.every(x=>/^SELECT\s/i.test(x)));});
test('invalid seat quantity rejected before database reads',async()=>{const {sql,env}=setup();const res=await handleSeatAdmin(req({...order,line_items:[{sku,variant_id:456,quantity:2}]}),env);assert.equal(res.status,422);assert.equal(sql.length,0);});
test('oversized payload rejected before database reads',async()=>{const {sql,env}=setup();const res=await handleSeatAdmin(req({...order,padding:'x'.repeat(66000)}),env);assert.equal(res.status,413);assert.equal(sql.length,0);});
test('GET is not allowed',async()=>{const {env}=setup();const res=await handleSeatAdmin(new Request('https://example.com/api/seats/admin/ownership-preview',{headers:{authorization:`Bearer ${token}`}}),env);assert.equal(res.status,405);});
