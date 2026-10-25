import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook} from './helpers/verified-shopify-webhook-fixture.mjs';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const secret='v95-integration-test-secret';
const rid='reservation_123456789';
const nonce='nonce_1234567890123456789012';
const sku='WM-ST-105-B-06';
const order={id:123,line_items:[{sku,quantity:1,variant_id:456}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
const reservation={id:rid,status:'HELD',checkout_nonce:nonce,expires_at:'2099-01-01T00:00:00.000Z',shopify_order_id:null};
const seat={sku,status:'HELD',shopify_variant_id:'gid://shopify/ProductVariant/456',shopify_order_id:null,hold_id:rid,hold_expires_at:'2099-01-01T00:00:00.000Z'};
function fakeDb({res=reservation,linked=[{seat_sku:sku,shopify_variant_id:seat.shopify_variant_id}],rows=[seat]}={}){
 const queries=[];
 return {queries,prepare(sql){queries.push(sql);if(!/^SELECT\s/i.test(sql))throw Error('UNEXPECTED_WRITE');return {bind(){return {first:async()=>res,all:async()=>({results:sql.includes('reservation_seats')?linked:rows})}}}}};
}
function signedRequest(payload=order,{topic='orders/paid',tamper=false}={}){
 const body=JSON.stringify(payload);const hmac=createHmac('sha256',secret).update(body).digest('base64');
 return new Request('https://tickets.example/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':topic,'x-shopify-hmac-sha256':hmac},body:tamper?body+' ':body});
}
async function run(payload,opts={},state={}){const db=fakeDb(state);const response=await handleShopifyPaidWebhook(signedRequest(payload,opts),{SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db});return {response,body:await response.json(),queries:db.queries};}
test('valid signed paid assigned-seat order is inspected but not acknowledged or written',async()=>{const r=await run(order);assert.equal(r.response.status,503);assert.equal(r.body.inspection.reason,'PAID_COMMIT_PREPARED');assert.equal(r.body.inspection.proposed_seat_updates,1);assert.equal(r.body.inspection.fulfillment_enabled,false);assert.ok(r.queries.length>0);assert.ok(r.queries.every(x=>/^SELECT\s/i.test(x)))});
test('tampered signed payload is rejected before any database reads',async()=>{const db=fakeDb();const response=await handleShopifyPaidWebhook(signedRequest(order,{tamper:true}),{SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db});assert.equal(response.status,401);assert.equal(db.queries.length,0)});
test('incorrect checkout nonce is rejected without writes',async()=>{const r=await run({...order,note_attributes:[order.note_attributes[0],{name:'wm_checkout_nonce',value:'wrong_nonce_123456789012345678'}]});assert.equal(r.response.status,503);assert.equal(r.body.inspection.detail,'CHECKOUT_NONCE_MISMATCH');assert.ok(r.queries.every(x=>/^SELECT\s/i.test(x)))});
test('foreign hold is rejected without writes',async()=>{const r=await run(order,{}, {rows:[{...seat,hold_id:'reservation_foreign123456'}]});assert.equal(r.response.status,503);assert.equal(r.body.inspection.detail,'HOLD_OWNERSHIP_MISMATCH')});
test('unrelated merchandise order is ignored without database reads',async()=>{const r=await run({...order,line_items:[{sku:'SHIRT',quantity:1,variant_id:789}]});assert.equal(r.response.status,200);assert.equal(r.body.ignored,true);assert.equal(r.queries.length,0)});
test('duplicate paid seat variant is rejected before database reads',async()=>{const r=await run({...order,line_items:[order.line_items[0],{sku:'WM-ST-105-B-07',quantity:1,variant_id:456}]});assert.equal(r.response.status,422);assert.equal(r.body.error,'INVALID_SEAT_ORDER');assert.equal(r.queries.length,0)});
test('duplicate database seat records never acknowledge the order',async()=>{const r=await run(order,{}, {rows:[seat,seat]});assert.equal(r.response.status,503);assert.equal(r.body.inspection.reason,'DATABASE_SEAT_COUNT_MISMATCH');assert.ok(r.queries.every(x=>/^SELECT\s/i.test(x)))});
