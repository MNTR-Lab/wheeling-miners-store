/** V51: regression tests for paid-order webhook failure-closed behavior.
 * Fake D1 only. Never connects to Shopify or modifies production seats.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, webcrypto} from 'node:crypto';
import {handleSeatApi} from '../src/seat-api.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const SECRET='unit-test-secret';
const SKU='WM-ST-105-A-01';
function database(rows=[]){
 const calls=[];
 return {calls, prepare(sql){
  assert.match(sql,/^\s*SELECT\b/i,'Webhook must not write to D1');
  return {bind(...params){return {async all(){calls.push({sql,params});return {results:rows.filter(r=>params.includes(r.sku))}}}}};
 }};
}
async function send(payload,{rows=[],secret=SECRET,topic='orders/paid',signature,raw}={}){
 const db=database(rows);
 const body=raw??JSON.stringify(payload);
 const sig=signature??createHmac('sha256',SECRET).update(body).digest('base64');
 const req=new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-hmac-sha256':sig,'x-shopify-topic':topic},body});
 const response=await handleSeatApi(req,{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret});
 return {status:response.status,data:await response.json(),calls:db.calls};
}
const order=(items)=>({id:123,line_items:items});
const line=(sku=SKU,variant_id=123,quantity=1)=>({sku,variant_id,quantity});
test('rejects a valid signature if webhook topic is not orders/paid',async()=>{
 const r=await send(order([line()]),{topic:'orders/create'});assert.equal(r.status,422);assert.equal(r.calls.length,0);
});
test('rejects signature made with wrong key before querying D1',async()=>{
 const r=await send(order([line()]),{signature:createHmac('sha256','wrong').update(JSON.stringify(order([line()]))).digest('base64')});
 assert.equal(r.status,401);assert.equal(r.calls.length,0);
});
test('rejects malformed JSON after validating signature',async()=>{
 const r=await send(null,{raw:'{bad'});assert.equal(r.status,400);assert.equal(r.calls.length,0);
});
test('ignores paid orders without any assigned-seat SKUs',async()=>{
 const r=await send(order([line('REGULAR-MERCH',123)]));assert.equal(r.status,200);assert.equal(r.data.ignored,true);assert.equal(r.calls.length,0);
});
test('rejects repeated seat SKUs in paid order',async()=>{
 const r=await send(order([line(),line()]));assert.equal(r.status,409);assert.equal(r.calls.length,0);
});
test('rejects quantity greater than one for an assigned seat',async()=>{
 const r=await send(order([line(SKU,123,2)]));assert.equal(r.status,409);assert.equal(r.calls.length,0);
});
test('rejects a paid seat with a different Shopify variant ID',async()=>{
 const r=await send(order([line()]),{rows:[{sku:SKU,status:'AVAILABLE',shopify_variant_id:'gid://shopify/ProductVariant/999',shopify_order_id:null}]});
 assert.equal(r.status,409);assert.equal(r.data.requires_reconciliation,true);
});
test('rejects payment for an unreleased seat even when variant matches',async()=>{
 const r=await send(order([line()]),{rows:[{sku:SKU,status:'UNRELEASED',shopify_variant_id:'gid://shopify/ProductVariant/123',shopify_order_id:null}]});
 assert.equal(r.status,409);
});
test('rejects payment for a seat attached to another order',async()=>{
 const r=await send(order([line()]),{rows:[{sku:SKU,status:'AVAILABLE',shopify_variant_id:'gid://shopify/ProductVariant/123',shopify_order_id:'999'}]});
 assert.equal(r.status,409);
});
test('even a valid mapped paid order does not auto-fulfill or write',async()=>{
 const r=await send(order([line()]),{rows:[{sku:SKU,status:'AVAILABLE',shopify_variant_id:'gid://shopify/ProductVariant/123',shopify_order_id:null}]});
 assert.equal(r.status,503);assert.equal(r.data.staging,true);assert.equal(r.data.requires_reconciliation,true);assert.equal(r.calls.length,1);
});
test('rejects oversized signed webhook payload',async()=>{
 const body=JSON.stringify({...order([line()]),padding:'x'.repeat(1024*1024)});
 const r=await send(null,{raw:body});assert.equal(r.status,413);assert.equal(r.calls.length,0);
});
