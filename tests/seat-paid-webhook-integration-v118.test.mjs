/** V118: signed paid-order webhook end-to-end rehearsal with an isolated fake D1.
 * No real Shopify requests or production database writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='isolated-webhook-test-secret';
const rid='reservation_123456789',nonce='nonce_1234567890123456789012',sku='WM-ST-105-B-06';
const variant='gid://shopify/ProductVariant/456',expires=Date.parse('2099-01-01T00:00:00Z');
const order={id:123,line_items:[{sku,variant_id:456,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
const reservation={id:rid,status:'CHECKOUT_PENDING',checkout_nonce:nonce,expires_at:expires,shopify_order_id:null};
const seat={sku,status:'HELD',hold_id:rid,hold_expires_at:expires,shopify_order_id:null,shopify_variant_id:variant};
function signed(body=order){
 const raw=JSON.stringify(body);
 return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-hmac-sha256':createHmac('sha256',secret).update(raw).digest('base64')},body:raw});
}
function fakeDb({r=reservation,s=seat,links=[{seat_sku:sku,shopify_variant_id:variant}],throwBatch=false}={}){
 const calls=[],batches=[];
 const db={prepare(sql){
  const entry={sql,params:[]};calls.push(entry);
  return {bind(...params){entry.params=params;return this},
   async first(){assert.match(sql,/^SELECT/);return r},
   async all(){assert.match(sql,/^SELECT/);return {results:sql.includes('reservation_seats')?links:[s]}}
  };
 },async batch(statements){batches.push(statements);if(throwBatch)throw Error('D1_CONFLICT');}};
 return {db,calls,batches};
}
const env=db=>({SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db,SEAT_PAID_FULFILLMENT_ENABLED:'true'});
test('signed paid order prepares guarded seat + CONFIRMED reservation batch',async()=>{
 const f=fakeDb();const response=await handleShopifyPaidWebhook(signed(),env(f.db));
 assert.equal(response.status,200);assert.equal((await response.json()).seat_count,1);
 assert.equal(f.batches.length,1);assert.equal(f.batches[0].length,7);
 assert.equal(f.calls.filter(x=>x.sql.includes('CASE WHEN changes()=1')).length,2);
 assert.ok(f.calls.some(x=>x.sql.includes("status='CONFIRMED'")));
 assert.ok(f.calls.some(x=>x.sql.includes("status='SOLD'")));
});
test('fulfillment remains default-off even with valid signed order',async()=>{
 const f=fakeDb();const response=await handleShopifyPaidWebhook(signed(),{SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:f.db});
 assert.equal(response.status,503);assert.equal(f.batches.length,0);
});
test('nonce mismatch never batches',async()=>{
 const f=fakeDb();const bad={...order,note_attributes:[order.note_attributes[0],{name:'wm_checkout_nonce',value:'incorrect_nonce_123456789012345'}]};
 assert.equal((await handleShopifyPaidWebhook(signed(bad),env(f.db))).status,503);
 assert.equal(f.batches.length,0);
});
test('wrong Shopify variant never batches',async()=>{
 const f=fakeDb();const bad={...order,line_items:[{...order.line_items[0],variant_id:999}]};
 assert.equal((await handleShopifyPaidWebhook(signed(bad),env(f.db))).status,503);
 assert.equal(f.batches.length,0);
});
test('unreleased seat never batches',async()=>{
 const f=fakeDb({s:{...seat,status:'UNRELEASED'}});
 assert.equal((await handleShopifyPaidWebhook(signed(),env(f.db))).status,503);
 assert.equal(f.batches.length,0);
});
test('database conflict yields retryable response, not success',async()=>{
 const f=fakeDb({throwBatch:true});
 assert.equal((await handleShopifyPaidWebhook(signed(),env(f.db))).status,503);
 assert.equal(f.batches.length,1);
});
test('replayed same paid order is acknowledged without new batch',async()=>{
 const f=fakeDb({r:{...reservation,status:'CONFIRMED',shopify_order_id:'123'},s:{...seat,status:'SOLD',hold_id:null,hold_expires_at:null,shopify_order_id:'123'}});
 const response=await handleShopifyPaidWebhook(signed(),env(f.db));
 assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 assert.equal(f.batches.length,0);
});
