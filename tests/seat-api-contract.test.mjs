/** V50: runtime staging contract tests, using a fake D1 binding. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleSeatApi } from '../src/seat-api.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const seat = {sku:'WM-ST-105-A-01',status:'UNRELEASED',shopify_variant_id:null};
function fakeDB(){
 const calls=[];
 const db={prepare(sql){const q={sql,args:[],bind(...args){this.args=args;return this},async all(){calls.push({sql,args:this.args});if(sql.includes('GROUP BY status'))return {results:[{status:'UNRELEASED',count:3737}]};if(sql.includes('FROM seats WHERE section='))return {results:[{...seat,row:'A',seat_number:1,price_cents:16000}]};return {results:[seat]};},async first(){calls.push({sql,args:this.args});if(sql.includes('COUNT(DISTINCT section)'))return {total:3737,sections:63,unreleased:3737,available:0,held:0,sold:0,mapped:0,available_without_variant:0};return {count:0,n:0};}};return q}};
 return {db,calls};
}
async function call(path,{method='GET',body,headers={},secret}={}){const {db,calls}=fakeDB();const request=new Request('https://example.test'+path,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});const response=await handleSeatApi(request,{SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:secret});return {status:response.status,data:await response.json(),calls};}
test('status reports staging and disabled sales',async()=>{const x=await call('/api/seats/status');assert.equal(x.status,200);assert.equal(x.data.checkout_enabled,false);assert.equal(x.data.holds_enabled,false);});
test('readiness never authorizes sales even with expected seat counts',async()=>{const x=await call('/api/seats/readiness');assert.equal(x.data.ready_for_sales,false);assert.equal(x.data.checkout_enabled,false);assert.ok(x.data.blockers.length);});
test('hold and checkout refuse with 423 and no database writes',async()=>{for(const p of ['/api/seats/hold','/api/seats/checkout']){const x=await call(p,{method:'POST',body:{skus:[seat.sku]}});assert.equal(x.status,423);assert.equal(x.calls.length,0);}});
test('selection check never permits checkout',async()=>{const x=await call('/api/seats/selection-check',{method:'POST',body:{skus:[seat.sku]}});assert.equal(x.status,200);assert.equal(x.data.can_checkout,false);assert.equal(x.data.can_hold,false);assert.equal(x.data.seats[0].eligible,false);});
test('invalid and duplicate selections rejected',async()=>{for(const skus of [[seat.sku,seat.sku],['INVALID'],[]]){const x=await call('/api/seats/selection-check',{method:'POST',body:{skus}});assert.equal(x.status,400);}});
test('section returns read-only seats',async()=>{const x=await call('/api/seats/section/105');assert.equal(x.status,200);assert.equal(x.data.checkout_enabled,false);assert.equal(x.data.seats[0].sku,seat.sku);});
test('Shopify webhook rejects missing secret and invalid signature',async()=>{const x=await call('/api/seats/webhooks/shopify',{method:'POST',body:'{}'});assert.equal(x.status,503);const y=await call('/api/seats/webhooks/shopify',{method:'POST',body:'{}',secret:'testing-secret',headers:{'x-shopify-hmac-sha256':'bad'}});assert.equal(y.status,401);});
test('signed Shopify webhook cannot fulfill staged seat',async()=>{const body=JSON.stringify({id:123,line_items:[{sku:seat.sku,quantity:1,variant_id:555}]});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('testing-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('base64');const x=await call('/api/seats/webhooks/shopify',{method:'POST',body,secret:'testing-secret',headers:{'x-shopify-hmac-sha256':sig,'x-shopify-topic':'orders/paid'}});assert.equal(x.status,409);assert.equal(x.data.requires_reconciliation,true);assert.ok(x.calls.every(c=>/^\s*SELECT\b/i.test(c.sql)));});
