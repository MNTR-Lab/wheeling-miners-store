/** V121: ensure deployed Worker uses the guarded webhook, not the legacy seat-api route.
 * No production services or database writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import worker from '../src/worker.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='worker-routing-test-secret';
const order={id:123,line_items:[{sku:'WM-ST-105-B-06',variant_id:456,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:'reservation_123456789'},{name:'wm_checkout_nonce',value:'nonce_1234567890123456789012'}]};
function signed(body=order){
 const raw=JSON.stringify(body);
 return new Request('https://example.test/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-hmac-sha256':createHmac('sha256',secret).update(raw).digest('base64')},body:raw});
}
function environment(){
 const sql=[];
 return {sql,env:{SHOPIFY_WEBHOOK_SECRET:secret,SEAT_DB:{prepare(query){sql.push(query);if(!/^SELECT\s/i.test(query))throw Error('WRITE_FORBIDDEN');return {bind(){return {first:async()=>null,all:async()=>({results:[]})}}}},batch(){throw Error('BATCH_FORBIDDEN')}},ASSETS:{fetch(){throw Error('ASSET_ROUTE_FORBIDDEN')}}}};
}
test('deployed webhook route uses default-off guarded handler',async()=>{
 const {env,sql}=environment();const response=await worker.fetch(signed(),env);
 assert.equal(response.status,503);const body=await response.json();
 assert.equal(body.error,'MANUAL_RECONCILIATION_REQUIRED');
 assert.equal(body.staging,true);assert.ok(sql.every(x=>/^SELECT\s/i.test(x)));
});
test('deployed webhook route rejects invalid signature before DB access',async()=>{
 const {env,sql}=environment();const req=signed();req.headers.set('x-shopify-hmac-sha256','bad');
 const response=await worker.fetch(req,env);assert.equal(response.status,401);assert.equal(sql.length,0);
});
test('deployed webhook route ignores nonseat orders',async()=>{
 const {env,sql}=environment();const response=await worker.fetch(signed({...order,line_items:[{sku:'SHIRT',quantity:1}]}),env);
 assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);assert.equal(sql.length,0);
});
test('deployed webhook route does not permit GET',async()=>{
 const {env,sql}=environment();const response=await worker.fetch(new Request('https://example.test/api/seats/webhooks/shopify'),env);
 assert.equal(response.status,405);assert.equal(sql.length,0);
});
test('public checkout and holds remain locked',async()=>{
 const {env}=environment();
 for(const path of ['/api/seats/hold','/api/seats/checkout']){
  const response=await worker.fetch(new Request('https://example.test'+path,{method:'POST'}),env);
  assert.equal(response.status,423);
 }
});
