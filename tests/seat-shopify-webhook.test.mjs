import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook,validShopifySignature} from '../src/seat-shopify-webhook.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='local-test-secret';
async function signature(raw){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');}
async function request(order,{topic='orders/paid',signed=true}={}){const body=JSON.stringify(order);return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':topic,'x-shopify-hmac-sha256':signed?await signature(body):'invalid'},body});}
const db={prepare:()=>({bind:()=>({all:async()=>({results:[]})})})};
const env={SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:db};
const seat={id:42,line_items:[{sku:'WM-ST-105-B-06',variant_id:456,quantity:1}]};
test('signature verification accepts valid HMAC',async()=>assert.equal(await validShopifySignature(new TextEncoder().encode('abc'),await signature('abc'),secret),true));
test('signature verification rejects invalid HMAC',async()=>assert.equal(await validShopifySignature(new TextEncoder().encode('abc'),await signature('abcd'),secret),false));
test('rejects unsigned requests',async()=>assert.equal((await handleShopifyPaidWebhook(await request(seat,{signed:false}),env)).status,401));
test('rejects unsupported topic',async()=>assert.equal((await handleShopifyPaidWebhook(await request(seat,{topic:'orders/create'}),env)).status,422));
test('ignores non-seat paid orders',async()=>{const r=await handleShopifyPaidWebhook(await request({id:42,line_items:[{sku:'SHIRT'}]}),env);assert.equal(r.status,200);assert.equal((await r.json()).ignored,true);});
test('paid seats remain unacknowledged for fulfillment',async()=>{const r=await handleShopifyPaidWebhook(await request(seat),env);assert.equal(r.status,503);assert.equal((await r.json()).requires_reconciliation,true);});
test('duplicate seat SKUs rejected',async()=>assert.equal((await handleShopifyPaidWebhook(await request({...seat,line_items:[...seat.line_items,...seat.line_items]}),env)).status,422));
test('unconfigured webhook fails closed',async()=>assert.equal((await handleShopifyPaidWebhook(await request(seat),{SEAT_DB:db})).status,503));
test('GET method rejected',async()=>assert.equal((await handleShopifyPaidWebhook(new Request('https://example.test/api/seats/webhooks/shopify'),env)).status,405));
