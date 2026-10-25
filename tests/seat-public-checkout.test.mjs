import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePublicCheckout,publicSalesEnabled} from '../src/seat-public-checkout.js';
// Test-only dummy credentials. No real Shopify calls or production writes.
const base={WM_ENVIRONMENT:'PRODUCTION',SEAT_PUBLIC_SALES_ENABLED:'true',SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_CONTROLLED_CART_ENABLED:'true',SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true',SHOPIFY_WEBHOOK_SECRET:'fixture-webhook-secret',SHOPIFY_CLIENT_ID:'fixture-client-id',SHOPIFY_CLIENT_SECRET:'fixture-client-secret',SHOPIFY_STOREFRONT_TOKEN:'fixture-storefront-token',SHOPIFY_STORE_DOMAIN:'miners-shop.myshopify.com'};
const req=(path,body)=>new Request('https://example.com'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('fails closed without explicit production approval and required flags',()=>{
 for(const key of Object.keys(base)){
  const missing={...base};delete missing[key];assert.equal(publicSalesEnabled(missing),false,`missing ${key}`);
 }
 for(const key of ['SEAT_PUBLIC_SALES_ENABLED','SEAT_PUBLIC_SALES_APPROVED','SEAT_CONTROLLED_CART_ENABLED','SEAT_PAID_FULFILLMENT_ENABLED','SEAT_PRODUCTION_PAID_COMMIT_APPROVED'])assert.equal(publicSalesEnabled({...base,[key]:'false'}),false,key);
 assert.equal(publicSalesEnabled({...base,SHOPIFY_STORE_DOMAIN:'wheeling-miners-ticket-testing.myshopify.com'}),false);
 assert.equal(publicSalesEnabled(base),true);
});
test('TEST environment never enables public holds or checkout',async()=>{
 const env={...base,WM_ENVIRONMENT:'TEST'};
 for(const path of ['/api/seats/hold','/api/seats/checkout']){
  const response=await handlePublicCheckout(req(path,{skus:['WM-ST-105-B-03']}),env);
  assert.equal(response.status,423);assert.equal((await response.json()).error,'PUBLIC_SALES_NOT_ENABLED');
 }
});
test('disabled environment cannot touch the database',async()=>{
 const env={...base,SEAT_PUBLIC_SALES_ENABLED:'false',SEAT_DB:{get prepare(){throw Error('DB should not be accessed')}}};
 const response=await handlePublicCheckout(req('/api/seats/hold',{skus:['WM-ST-105-B-03']}),env);
 assert.equal(response.status,423);
});
test('unknown routes do not intercept staging API',async()=>{
 assert.equal(await handlePublicCheckout(req('/api/seats/status',{}),base),null);
});
test('invalid selections fail without writing',async()=>{
 const env={...base,SEAT_DB:{prepare(){throw Error('should not query')},batch(){}}};
 const response=await handlePublicCheckout(req('/api/seats/hold',{skus:['bad']}),env);
 assert.equal(response.status,422);
});
test('checkout rejects malformed reservation ids before reading database',async()=>{
 const env={...base,SEAT_DB:{prepare(){throw Error('should not query')},batch(){}}};
 const response=await handlePublicCheckout(req('/api/seats/checkout',{reservationId:'bad'}),env);
 assert.equal(response.status,422);
});
