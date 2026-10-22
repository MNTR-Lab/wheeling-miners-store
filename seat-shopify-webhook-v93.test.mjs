import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='staging-test-secret';
const seat={sku:'WM-ST-105-B-06',variant_id:456,quantity:1};
const order={id:123,line_items:[seat],note_attributes:[]};
const db={prepare(){return {bind(){return {first:async()=>null,all:async()=>({results:[]})}}}}};
function req(body=order,opts={}){
 const raw=typeof body==='string'?body:JSON.stringify(body);
 const headers={'x-shopify-topic':opts.topic??'orders/paid'};
 if(!opts.unsigned)headers['x-shopify-hmac-sha256']=createHmac('sha256',secret).update(raw).digest('base64');
 return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers,body:raw});
}
const env={SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret};
test('assigned seat is never acknowledged',async()=>assert.equal((await handleShopifyPaidWebhook(req(),env)).status,503));
test('duplicate paid variant yields validation error',async()=>{const r=await handleShopifyPaidWebhook(req({...order,line_items:[seat,{...seat,sku:'WM-ST-105-B-07'}]}),env);assert.equal(r.status,422);assert.equal((await r.json()).error,'DUPLICATE_PAID_VARIANT')});
test('invalid signature denied',async()=>assert.equal((await handleShopifyPaidWebhook(req(order,{unsigned:true}),env)).status,401));
test('unrelated orders remain acknowledged',async()=>{const r=await handleShopifyPaidWebhook(req({...order,line_items:[{sku:'SHIRT'}]}),env);assert.equal(r.status,200)});
test('database exception is not leaked',async()=>{const broken={prepare(){throw Error('PRIVATE_DATABASE_DETAIL')}};const linked={...order,note_attributes:[{name:'wm_reservation_id',value:'reservation_123456789'}]};const r=await handleShopifyPaidWebhook(req(linked),{...env,SEAT_DB:broken});assert.equal(r.status,503);assert.equal((await r.json()).error,'RECONCILIATION_UNAVAILABLE')});
test('invalid JSON rejected',async()=>assert.equal((await handleShopifyPaidWebhook(req('{bad'),env)).status,400));
test('wrong topic rejected',async()=>assert.equal((await handleShopifyPaidWebhook(req(order,{topic:'orders/create'}),env)).status,422));
test('no DB configuration rejected',async()=>assert.equal((await handleShopifyPaidWebhook(req(),{SHOPIFY_WEBHOOK_SECRET:secret})).status,503));
