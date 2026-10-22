import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHmac} from 'node:crypto';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='test-only-secret';
const order={id:123,line_items:[{sku:'WM-ST-105-B-06',variant_id:456,quantity:1}],note_attributes:[]};
const db={prepare(sql){return {bind(){return {first:async()=>null,all:async()=>({results:[]})}}}}};
function request(body=order,{signature=true,topic='orders/paid',method='POST'}={}){
 const raw=JSON.stringify(body);
 const h={'x-shopify-topic':topic};
 if(signature)h['x-shopify-hmac-sha256']=createHmac('sha256',secret).update(raw).digest('base64');
 return new Request('https://example.test/api/seats/webhooks/shopify',{method,headers:h,body:method==='POST'?raw:undefined});
}
test('rejects missing webhook configuration',async()=>assert.equal((await handleShopifyPaidWebhook(request(),{SEAT_DB:db})).status,503));
test('rejects invalid signature',async()=>assert.equal((await handleShopifyPaidWebhook(request(order,{signature:false}),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret})).status,401));
test('rejects incorrect topic',async()=>assert.equal((await handleShopifyPaidWebhook(request(order,{topic:'orders/create'}),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret})).status,422));
test('nonseat orders are acknowledged',async()=>{const r=await handleShopifyPaidWebhook(request({...order,line_items:[{sku:'SHIRT',quantity:1}]}),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret});assert.equal(r.status,200);assert.equal((await r.json()).ignored,true)});
test('assigned-seat order without reservation attributes is never acknowledged',async()=>{const r=await handleShopifyPaidWebhook(request(),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret});assert.equal(r.status,503);assert.equal((await r.json()).inspection.reason,'INVALID_RESERVATION_LINK')});
test('invalid quantity rejected',async()=>{const r=await handleShopifyPaidWebhook(request({...order,line_items:[{...order.line_items[0],quantity:2}]}),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret});assert.equal(r.status,422)});
test('wrong method rejected',async()=>assert.equal((await handleShopifyPaidWebhook(request(order,{method:'GET'}),{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret})).status,405));
