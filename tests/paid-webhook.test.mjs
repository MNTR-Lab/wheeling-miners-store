import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, webcrypto} from 'node:crypto';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
globalThis.crypto ??= webcrypto;

const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const RID='wm_test_reservation_123456789';
const NONCE='wm_test_nonce_1234567890123456789';
const ORDER='18970068058169';
const SKU='WM-ST-105-B-02';
const VARIANT='50943009259577';
const SECRET='test-secret-never-used-on-shopify';
const created=Date.now()-60000;
const expires=Date.now()+600000;
const paidAt=new Date().toISOString();

function fixture({status='HELD',orderId=null,expiry=expires,reservationStatus='HELD',nonce=NONCE}={}){
 const state={
   reservation:{id:RID,status:reservationStatus,created_at:created,checkout_nonce:nonce,expires_at:expiry,shopify_order_id:orderId},
   seat:{sku:SKU,status,hold_id:status==='HELD'?RID:null,hold_expires_at:status==='HELD'?expiry:null,shopify_variant_id:`gid://shopify/ProductVariant/${VARIANT}`,shopify_order_id:orderId},
   batches:0
 };
 const db={
  prepare(sql){
   return {bind(...params){this.params=params;return this;},
    async first(){if(sql.includes('FROM reservations'))return state.reservation;throw Error('unexpected first SQL: '+sql)},
    async all(){
     if(sql.includes('FROM reservation_seats'))return {results:[{reservation_id:RID,seat_sku:SKU,shopify_variant_id:`gid://shopify/ProductVariant/${VARIANT}`}]};
     if(sql.includes('FROM seats'))return {results:[{...state.seat}]};
     throw Error('unexpected all SQL: '+sql);
    }};
  },
  async batch(statements){
   state.batches++;
   // A minimal test double checks the planner's intended writes, not SQLite atomicity.
   assert.ok(statements.some(x=>x.params?.[0]===ORDER&&x.params?.[1]===SKU));
   assert.ok(statements.some(x=>x.params?.[0]===ORDER&&x.params?.[1]===RID));
   state.seat={...state.seat,status:'SOLD',shopify_order_id:ORDER,hold_id:null,hold_expires_at:null};
   state.reservation={...state.reservation,status:'CONFIRMED',shopify_order_id:ORDER};
   return [];
  }
 };
 return {state,db};
}
const order=()=>({
 id:Number(ORDER),
 line_items:[{sku:SKU,quantity:1,variant_id:Number(VARIANT)}],
 note_attributes:[{name:'wm_reservation_id',value:RID},{name:'wm_checkout_nonce',value:NONCE}]
});
function signedRequest(payload=order(),overrides={}){
 const body=JSON.stringify(payload);
 const signature=createHmac('sha256',SECRET).update(body).digest('base64');
 return new Request('https://example.test/api/seats/webhooks/shopify',{
  method:'POST',
  headers:{'content-type':'application/json','x-shopify-topic':'orders/paid','x-shopify-shop-domain':SHOP,'x-shopify-hmac-sha256':signature,...overrides},
  body
 });
}
function shopifyFetch(url){
 const u=String(url);
 if(u.includes('/oauth/access_token'))return Promise.resolve(Response.json({access_token:'unit-test-token',scope:'read_orders'}));
 if(u.includes('/transactions.json'))return Promise.resolve(Response.json({transactions:[{kind:'sale',status:'success',processed_at:paidAt}]}));
 if(u.includes('/orders/'))return Promise.resolve(Response.json({order:{id:Number(ORDER),financial_status:'paid'}}));
 throw Error('Unexpected external request '+u);
}
function env(db){return {
 SEAT_DB:db,SHOPIFY_WEBHOOK_SECRET:SECRET,SHOPIFY_CLIENT_ID:'fake-client',SHOPIFY_CLIENT_SECRET:'fake-secret',
 SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_TEST_AUTO_PAID_ENABLED:'true',
 WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:SHOP
}}
test('valid signed paid webhook commits a held seat; duplicate delivery is idempotent',async()=>{
 const {db,state}=fixture();
 const first=await handleShopifyPaidWebhook(signedRequest(),env(db),{fetchImpl:shopifyFetch});
 assert.equal(first.status,200);
 assert.equal(state.seat.status,'SOLD');
 assert.equal(state.reservation.status,'CONFIRMED');
 assert.equal(state.batches,1);
 const replay=await handleShopifyPaidWebhook(signedRequest(),env(db),{fetchImpl:shopifyFetch});
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).replayed,true);
 assert.equal(state.batches,1);
});
test('wrong shop and forged signature never write',async()=>{
 const {db,state}=fixture();
 const wrong=await handleShopifyPaidWebhook(signedRequest(order(),{'x-shopify-shop-domain':'different.myshopify.com'}),env(db),{fetchImpl:shopifyFetch});
 assert.equal(wrong.status,403);
 const forged=await handleShopifyPaidWebhook(signedRequest(order(),{'x-shopify-hmac-sha256':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}),env(db),{fetchImpl:shopifyFetch});
 assert.equal(forged.status,401);
 assert.equal(state.batches,0);
});
test('TEST automation disabled prevents writes',async()=>{
 const {db,state}=fixture();
 const config=env(db);config.SEAT_TEST_AUTO_PAID_ENABLED='false';config.SEAT_TEST_PAID_ORDER_ID='none';
 const result=await handleShopifyPaidWebhook(signedRequest(),config,{fetchImpl:shopifyFetch});
 assert.equal(result.status,503);
 assert.equal(state.batches,0);
});
test('expired reservation paid after expiration requires reconciliation',async()=>{
 const {db,state}=fixture({expiry:Date.now()-300000});
 const result=await handleShopifyPaidWebhook(signedRequest(),env(db),{fetchImpl:shopifyFetch});
 assert.equal(result.status,503);
 assert.equal(state.batches,0);
});
test('invalid checkout nonce cannot mark a seat SOLD',async()=>{
 const {db,state}=fixture({nonce:'different_nonce_12345678901234567890'});
 const result=await handleShopifyPaidWebhook(signedRequest(),env(db),{fetchImpl:shopifyFetch});
 assert.equal(result.status,503);
 assert.equal(state.batches,0);
});
