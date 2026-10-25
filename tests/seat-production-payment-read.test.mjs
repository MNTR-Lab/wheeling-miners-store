import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductionPaymentReads} from '../scripts/wm-production-payment-read.mjs';
function fixture(){
 const f={calls:[],logs:[],empty:false,status:200,paid:true,transactions:[{id:1,kind:'sale',status:'success',processed_at:'2026-10-25T12:00:00Z',amount:'65.00'}]};
 f.env={WM_SHOPIFY_PRODUCTION_STORE_DOMAIN:'186815-4c.myshopify.com',WM_SHOPIFY_CLIENT_ID:'offline-client',WM_SHOPIFY_CLIENT_SECRET:'offline-secret'};
 f.fetch=async(url,opts)=>{f.calls.push({url,opts});assert.equal(new URL(url).hostname,f.env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN);assert.equal(opts.redirect,'error');assert.ok(opts.signal);if(url.endsWith('/admin/oauth/access_token')){assert.equal(opts.method,'POST');return Response.json({access_token:'offline-access-token',scope:'read_products,read_orders'})}assert.equal(opts.method,'GET','All resource operations must be GET');assert.equal(opts.headers['x-shopify-access-token'],'offline-access-token');if(f.status!==200)return Response.json({error:'sensitive-server-value'},{status:f.status});if(url.includes('/transactions.json'))return Response.json({transactions:f.transactions});if(url.includes('/orders.json'))return Response.json({orders:f.empty?[]:[{id:12345}]});return Response.json({order:{id:12345,financial_status:f.paid?'paid':'pending',customer:{email:'not-printed@example.invalid'}}})};
 f.run=()=>verifyProductionPaymentReads(f.env,{fetchImpl:f.fetch,log:x=>f.logs.push(x)});return f;
}
test('reads one existing paid order and transaction using GET with no sensitive output',async()=>{const f=fixture();assert.equal((await f.run()).transactionReadVerified,true);assert.equal(f.calls.length,4);for(const value of ['offline-secret','offline-access-token','12345','65.00','not-printed'])assert.ok(!f.logs.join('\n').includes(value))});
test('explicit order ID skips discovery without creating an order',async()=>{const f=fixture();f.env.WM_VERIFY_ORDER_ID='12345';await f.run();assert.equal(f.calls.length,3);assert.ok(!f.calls.some(c=>c.url.includes('/orders.json')))});
test('wrong store fails before credentials are sent',async()=>{const f=fixture();f.env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN='test.myshopify.com';await assert.rejects(f.run(),/Incorrect production/);assert.equal(f.calls.length,0)});
test('malformed order ID fails before any API call',async()=>{const f=fixture();f.env.WM_VERIFY_ORDER_ID='../123';await assert.rejects(f.run(),/numeric Shopify order ID/);assert.equal(f.calls.length,0)});
test('no paid order does not count as payment-read success',async()=>{const f=fixture();f.empty=true;await assert.rejects(f.run(),/no paid order was found/);assert.equal(f.calls.length,2)});
test('protected order-data denial reports status without response contents',async()=>{const f=fixture();f.status=403;await assert.rejects(f.run(),e=>{assert.match(e.message,/order read failed HTTP 403/);assert.ok(!e.message.includes('sensitive-server-value'));return true})});
test('unpaid order cannot prove paid-order access',async()=>{const f=fixture();f.paid=false;await assert.rejects(f.run(),/not currently paid/);assert.equal(f.calls.length,3)});
test('authorization-only transaction does not count as captured payment',async()=>{const f=fixture();f.transactions=[{kind:'authorization',status:'success',processed_at:'2026-10-25T12:00:00Z'}];await assert.rejects(f.run(),/no successful sale\/capture/)});
test('invalid payment timestamp is rejected',async()=>{const f=fixture();f.transactions[0].processed_at='bad';await assert.rejects(f.run(),/no usable payment timestamp/)});
