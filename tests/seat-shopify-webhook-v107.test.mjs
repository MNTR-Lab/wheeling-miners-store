import test from 'node:test';
import assert from 'node:assert/strict';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
const secret='test-webhook-secret';
const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const base={WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:SHOP,SEAT_PAID_FULFILLMENT_ENABLED:'false'};
async function signed(order,topic='orders/paid',shop=SHOP){
 const raw=JSON.stringify(order);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
 const sig=btoa(String.fromCharCode(...mac));
 return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-hmac-sha256':sig,'x-shopify-topic':topic,'x-shopify-shop-domain':shop},body:raw});
}
const order={id:123,line_items:[{sku:'WM-ST-105-B-06',variant_id:456,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:'reservation_123456789'},{name:'wm_checkout_nonce',value:'nonce_1234567890123456789012'}]};
function db(){const reads=[];return {reads,prepare(sql){reads.push(sql);if(!/^SELECT\s/i.test(sql))throw Error('UNEXPECTED_WRITE');return {bind(){return {first:async()=>null,all:async()=>({results:[]})}}}},batch(){throw Error('UNEXPECTED_BATCH')}}}
test('default-off gate never writes and requires reconciliation',async()=>{const d=db();const res=await handleShopifyPaidWebhook(await signed(order),{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:d});assert.equal(res.status,503);assert.equal((await res.json()).staging,true);assert.ok(d.reads.every(s=>/^SELECT\s/i.test(s)))});
test('wrong signature rejected before any database read',async()=>{const d=db();const req=await signed(order);req.headers.set('x-shopify-hmac-sha256','invalid');const res=await handleShopifyPaidWebhook(req,{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:d});assert.equal(res.status,401);assert.equal(d.reads.length,0)});
test('wrong topic is rejected',async()=>{const res=await handleShopifyPaidWebhook(await signed(order,'orders/create'),{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db()});assert.equal(res.status,422)});
test('non-seat orders are ignored',async()=>{const res=await handleShopifyPaidWebhook(await signed({...order,line_items:[{sku:'SHIRT',quantity:1}]}),{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db()});assert.equal(res.status,200);assert.equal((await res.json()).ignored,true)});
test('enabled path still refuses if transactional database is missing',async()=>{const d=db();delete d.batch;const res=await handleShopifyPaidWebhook(await signed(order),{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:d,SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_TEST_AUTO_PAID_ENABLED:'true'});assert.equal(res.status,503)});
test('wrong shop is rejected before database reads',async()=>{const d=db();const res=await handleShopifyPaidWebhook(await signed(order,'orders/paid','other.myshopify.com'),{...base,SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:d});assert.equal(res.status,403);assert.equal(d.reads.length,0)});
