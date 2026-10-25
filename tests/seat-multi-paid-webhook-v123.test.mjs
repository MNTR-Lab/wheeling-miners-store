/** V123: multi-seat signed paid webhook rehearsal against guarded D1 mock.
 * Never contacts Shopify or a production database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook} from './helpers/verified-shopify-webhook-fixture.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='multi-seat-rehearsal-secret',rid='reservation_123456789',nonce='nonce_1234567890123456789012';
const expires=Date.parse('2099-01-01T00:00:00Z');
const skus=['WM-ST-105-B-06','WM-ST-105-B-07'];
const variants=['gid://shopify/ProductVariant/456','gid://shopify/ProductVariant/457'];
const order={id:123,line_items:skus.map((sku,i)=>({id:100+i,sku,variant_id:456+i,quantity:1})),note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
function signed(payload=order){
 const raw=JSON.stringify(payload);
 return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-hmac-sha256':createHmac('sha256',secret).update(raw).digest('base64')},body:raw});
}
function fixture({seatOverrides=[],linkedOverrides=[],reservationOverrides={},failBatch=false}={}){
 const calls=[],batches=[];
 const reservation={id:rid,status:'CHECKOUT_PENDING',checkout_nonce:nonce,expires_at:expires,shopify_order_id:null,...reservationOverrides};
 const linked=skus.map((sku,i)=>({seat_sku:sku,shopify_variant_id:variants[i],...linkedOverrides[i]}));
 const seats=skus.map((sku,i)=>({sku,status:'HELD',hold_id:rid,hold_expires_at:expires,shopify_order_id:null,shopify_variant_id:variants[i],...seatOverrides[i]}));
 const db={prepare(sql){
  const entry={sql,params:[]};calls.push(entry);
  return {bind(...params){entry.params=params;return this},
   async first(){assert.match(sql,/^SELECT/);return reservation},
   async all(){assert.match(sql,/^SELECT/);return {results:sql.includes('reservation_seats')?linked:seats}}};
 },async batch(stmts){batches.push(stmts);if(failBatch)throw Error('D1_CONFLICT')}};
 return {env:{SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db,SEAT_PAID_FULFILLMENT_ENABLED:'true'},calls,batches};
}
test('two matching paid seats form one guarded atomic batch',async()=>{
 const f=fixture();const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.seat_count,2);
 assert.equal(f.batches.length,1);assert.equal(f.batches[0].length,10);
 assert.equal(f.calls.filter(x=>x.sql.includes("status='SOLD'")).length,2);
 assert.equal(f.calls.filter(x=>x.sql.includes("status='CONFIRMED'")).length,1);
});
test('one variant mismatch rejects entire multi-seat order',async()=>{
 const f=fixture({seatOverrides:[{}, {shopify_variant_id:'gid://shopify/ProductVariant/999'}]});
 const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,503);assert.equal(f.batches.length,0);
});
test('one competing hold rejects entire multi-seat order',async()=>{
 const f=fixture({seatOverrides:[{}, {hold_id:'reservation_competing_123456'}]});
 const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,503);assert.equal(f.batches.length,0);
});
test('one unreleased seat rejects entire multi-seat order',async()=>{
 const f=fixture({seatOverrides:[{}, {status:'UNRELEASED'}]});
 const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,503);assert.equal(f.batches.length,0);
});
test('transaction failure does not acknowledge payment',async()=>{
 const f=fixture({failBatch:true});const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,503);assert.equal(f.batches.length,1);
});
test('default-off gate prevents any multi-seat batch',async()=>{
 const f=fixture();delete f.env.SEAT_PAID_FULFILLMENT_ENABLED;
 const response=await handleShopifyPaidWebhook(signed(),f.env);
 assert.equal(response.status,503);assert.equal(f.batches.length,0);
});
