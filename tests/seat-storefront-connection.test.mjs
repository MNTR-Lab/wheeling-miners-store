import test from 'node:test';
import assert from 'node:assert/strict';
import {handleShopifyStorefrontConnection,verifyShopifyStorefrontConnection} from '../src/seat-shopify-storefront-auth.js';
import {handleSeatAdmin} from '../src/seat-admin.js';

const adminToken='a'.repeat(40);
const base={SHOPIFY_STORE_DOMAIN:'example.myshopify.com',SHOPIFY_STOREFRONT_TOKEN:'example-token-12345',SEAT_SHOPIFY_AUTH_PROBE_ENABLED:'true'};
const endpoint='https://example.test/api/seats/admin/storefront-connection';
const ok=()=>({ok:true,status:200,json:async()=>({data:{shop:{name:'Test Shop'}}})});

test('Storefront probe succeeds using a read-only GraphQL query and private token',async()=>{
 let calls=0;
 const result=await verifyShopifyStorefrontConnection(base,{fetchImpl:async(url,init)=>{
  calls++;
  assert.equal(url,'https://example.myshopify.com/api/2026-10/graphql.json');
  assert.equal(init.method,'POST');
  assert.equal(init.headers['Shopify-Storefront-Private-Token'],base.SHOPIFY_STOREFRONT_TOKEN);
  assert.equal(init.headers['x-shopify-storefront-access-token'],undefined);
  const body=JSON.parse(init.body);
  assert.match(body.query,/shop\s*\{\s*name\s*\}/);
  assert.doesNotMatch(body.query,/mutation|cartCreate|checkoutCreate/i);
  return ok();
 }});
 assert.equal(calls,1);
 assert.equal(result.connected,true);
 assert.equal(result.readOnly,true);
 assert.equal(result.cartCreated,false);
 assert.equal(result.inventoryChanged,false);
 assert.equal(result.publicCheckoutEnabled,false);
 assert.equal(JSON.stringify(result).includes(base.SHOPIFY_STOREFRONT_TOKEN),false);
});

test('probe remains disabled by default, without network access',async()=>{
 let called=false;
 const r=await handleShopifyStorefrontConnection(new Request(endpoint),{...base,SEAT_SHOPIFY_AUTH_PROBE_ENABLED:undefined},{fetchImpl:()=>{called=true;throw Error('unexpected')}});
 assert.equal(r.status,423);
 assert.equal(called,false);
});

test('probe refuses non-GET methods',async()=>{
 const r=await handleShopifyStorefrontConnection(new Request(endpoint,{method:'POST'}),base);
 assert.equal(r.status,405);
});

test('probe rejects invalid domain before contacting Shopify',async()=>{
 let called=false;
 await assert.rejects(verifyShopifyStorefrontConnection({...base,SHOPIFY_STORE_DOMAIN:'example.com'},{fetchImpl:()=>{called=true}}),/SHOPIFY_STOREFRONT_NOT_CONFIGURED/);
 assert.equal(called,false);
});

test('probe rejects Storefront GraphQL errors',async()=>{
 const r=await handleShopifyStorefrontConnection(new Request(endpoint),base,{fetchImpl:async()=>({ok:true,status:200,json:async()=>({errors:[{message:'Invalid token'}]})})});
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,'SHOPIFY_STOREFRONT_CONNECTION_FAILED');
});

test('admin routing refuses requests without valid bearer token',async()=>{
 const r=await handleSeatAdmin(new Request(endpoint),{...base,SEAT_DB:{prepare(){throw Error('DB_NOT_NEEDED')}},SEAT_ADMIN_TOKEN:adminToken});
 assert.equal(r.status,401);
});

test('admin routing succeeds with valid bearer token',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>ok();
 try{
  const r=await handleSeatAdmin(new Request(endpoint,{headers:{authorization:`Bearer ${adminToken}`}}),{...base,SEAT_DB:{prepare(){throw Error('DB_NOT_NEEDED')}},SEAT_ADMIN_TOKEN:adminToken});
  assert.equal(r.status,200);
  assert.equal((await r.json()).connected,true);
 }finally{globalThis.fetch=original}
});
