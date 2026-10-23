/** Production-lockdown regression tests. No real network, Shopify, or D1 mutations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSeatApi} from '../src/seat-api.js';
import {handleSeatAdmin} from '../src/seat-admin.js';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';

const token='a'.repeat(40);
const root='https://test.invalid';
function strictDB(){
 let calls=0;
 return {get calls(){return calls},prepare(){calls++;throw Error('UNEXPECTED_DATABASE_ACCESS')}};
}
function req(path,method='POST',body={}){
 return new Request(root+path,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}

test('public seat hold remains closed and does not access database',async()=>{
 const db=strictDB();
 const response=await handleSeatApi(req('/api/seats/hold'),{SEAT_DB:db});
 assert.equal(response.status,423);
 assert.equal(db.calls,0);
});

test('public checkout remains closed and does not access database',async()=>{
 const db=strictDB();
 const response=await handleSeatApi(req('/api/seats/checkout'),{SEAT_DB:db});
 assert.equal(response.status,423);
 assert.equal(db.calls,0);
});

test('admin controlled cart remains disabled without accessing database',async()=>{
 const db=strictDB();
 const response=await handleSeatAdmin(new Request(root+'/api/seats/admin/controlled-cart',{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({reservationId:'reservation_isolated_123456789'})
 }),{SEAT_DB:db,SEAT_ADMIN_TOKEN:token,SHOPIFY_STOREFRONT_TOKEN:'dummy-token-123456'});
 assert.equal(response.status,423);
 assert.equal(db.calls,0);
});

test('unauthenticated cart request cannot access database',async()=>{
 const db=strictDB();
 const response=await handleSeatAdmin(new Request(root+'/api/seats/admin/controlled-cart',{
  method:'POST',headers:{authorization:'Bearer incorrect','content-type':'application/json'},
  body:JSON.stringify({reservationId:'reservation_isolated_123456789'})
 }),{SEAT_DB:db,SEAT_ADMIN_TOKEN:token,SEAT_CONTROLLED_CART_ENABLED:'true'});
 assert.equal(response.status,401);
 assert.equal(db.calls,0);
});

test('paid webhook refuses operation without configured secret before database access',async()=>{
 const db=strictDB();
 const response=await handleShopifyPaidWebhook(req('/api/seats/webhooks/shopify'),{SEAT_DB:db});
 assert.equal(response.status,503);
 assert.equal(db.calls,0);
});
