import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProductionOrderAccess} from '../scripts/wm-production-order-access.mjs';
import {handleShopifyAdminConnection} from '../src/seat-shopify-admin-auth.js';
const SHOP='186815-4c.myshopify.com';
function fixture(){
 const f={calls:[],logs:[],workerScopes:'read_products,read_orders',githubScopes:'read_products,read_orders',status:null};
 f.env={WM_SHOPIFY_PRODUCTION_STORE_DOMAIN:SHOP,WM_SHOPIFY_CLIENT_ID:'github-client',WM_SHOPIFY_CLIENT_SECRET:'github-secret',WM_SEAT_ADMIN_TOKEN:'private-admin-token'};
 f.runtime={SEAT_SHOPIFY_AUTH_PROBE_ENABLED:'true',SHOPIFY_STORE_DOMAIN:SHOP,SHOPIFY_CLIENT_ID:'worker-client',SHOPIFY_CLIENT_SECRET:'worker-secret'};
 const shopify=async(url,options)=>{assert.equal(new URL(url).hostname,SHOP);if(String(url).endsWith('/admin/oauth/access_token')){const params=new URLSearchParams(options.body);const worker=params.get('client_id')==='worker-client';assert.equal(params.get('client_secret'),worker?'worker-secret':'github-secret');return Response.json({access_token:'offline-access-token',scope:worker?f.workerScopes:f.githubScopes})}assert.ok(String(url).endsWith('/graphql.json'));return Response.json({data:{shop:{name:'GOAT',myshopifyDomain:SHOP}}})};
 f.fetch=async(url,options)=>{f.calls.push(url);assert.equal(options.redirect,'error');assert.ok(options.signal);if(String(url).startsWith('https://wheeling-miners-store.bikard.workers.dev/')){assert.equal(options.headers.authorization,'Bearer private-admin-token');if(f.status)return Response.json({error:'private-value'},{status:f.status});return handleShopifyAdminConnection(new Request(url,options),f.runtime,{fetchImpl:shopify})}return shopify(url,options)};
 f.run=()=>auditProductionOrderAccess(f.env,{fetchImpl:f.fetch,log:x=>f.logs.push(x)});return f;
}
test('checks separate GitHub and actual Worker credentials through existing probe',async()=>{const f=fixture();assert.equal((await f.run()).workerAuthenticationVerified,true);assert.equal(f.calls.filter(x=>x.includes('/api/seats/admin/')).length,1);assert.ok(!f.logs.join('\n').includes('secret'));assert.ok(!f.logs.join('\n').includes(f.env.WM_SEAT_ADMIN_TOKEN))});
test('missing production admin token stops before any API request',async()=>{const f=fixture();delete f.env.WM_SEAT_ADMIN_TOKEN;await assert.rejects(f.run(),/Add GitHub secret WM_SEAT_ADMIN_TOKEN/);assert.equal(f.calls.length,0)});
test('TEST store cannot be mistaken for production',async()=>{const f=fixture();f.env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN='wheeling-miners-ticket-testing.myshopify.com';await assert.rejects(f.run(),/Incorrect production Shopify store/);assert.equal(f.calls.length,0)});
test('GitHub app missing read_orders fails before Worker probe',async()=>{const f=fixture();f.githubScopes='read_products';await assert.rejects(f.run(),/GitHub Shopify app lacks read_orders/);assert.equal(f.calls.filter(x=>x.includes('/api/seats/admin/')).length,0)});
test('Worker app missing read_orders is detected separately',async()=>{const f=fixture();f.workerScopes='read_products';await assert.rejects(f.run(),/Production Worker app lacks/)});
test('disabled Worker probe gives exact configuration instruction',async()=>{const f=fixture();delete f.runtime.SEAT_SHOPIFY_AUTH_PROBE_ENABLED;await assert.rejects(f.run(),/SEAT_SHOPIFY_AUTH_PROBE_ENABLED=true/)});
test('incorrect admin token response does not leak server error bodies',async()=>{const f=fixture();f.status=401;await assert.rejects(f.run(),error=>{assert.match(error.message,/admin authentication rejected/);assert.ok(!error.message.includes('private-value'));assert.ok(!error.message.includes('private-admin-token'));return true})});
test('Worker authentication failure does not expose returned server text',async()=>{const f=fixture();f.status=503;await assert.rejects(f.run(),/verify its SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET/)});
test('network errors are sanitized',async()=>{const f=fixture();await assert.rejects(auditProductionOrderAccess(f.env,{fetchImpl:async()=>{throw Error('secret raw server text')},log:()=>{}}),error=>{assert.ok(!error.message.includes('secret raw server text'));return true})});
