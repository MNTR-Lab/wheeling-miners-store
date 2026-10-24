import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyShopifyStorefrontConnection,handleShopifyStorefrontConnection} from '../src/seat-shopify-storefront-auth.js';
const env={SHOPIFY_STORE_DOMAIN:'wheeling-miners-ticket-testing.myshopify.com',SHOPIFY_STOREFRONT_TOKEN:'private-token-123456',SEAT_SHOPIFY_AUTH_PROBE_ENABLED:'true'};
test('private Storefront token is sent with correct header and no public token header',async()=>{
 const result=await verifyShopifyStorefrontConnection(env,{fetchImpl:async(url,init)=>{
  assert.equal(url,'https://wheeling-miners-ticket-testing.myshopify.com/api/2026-10/graphql.json');
  assert.equal(init.headers['Shopify-Storefront-Private-Token'],env.SHOPIFY_STOREFRONT_TOKEN);
  assert.equal(init.headers['x-shopify-storefront-access-token'],undefined);
  return {ok:true,json:async()=>({data:{shop:{name:'Wheeling Miners Ticket Testing'}}})};
 }});
 assert.equal(result.connected,true);assert.equal(result.publicCheckoutEnabled,false);
});
test('probe remains disabled unless explicitly enabled',async()=>{
 const response=await handleShopifyStorefrontConnection(new Request('https://example.test',{method:'GET'}),{...env,SEAT_SHOPIFY_AUTH_PROBE_ENABLED:'false'});
 assert.equal(response.status,423);
});
test('Shopify 401 is reported without exposing token',async()=>{
 await assert.rejects(verifyShopifyStorefrontConnection(env,{fetchImpl:async()=>({ok:false,status:401})}),/SHOPIFY_STOREFRONT_HTTP_401/);
});
