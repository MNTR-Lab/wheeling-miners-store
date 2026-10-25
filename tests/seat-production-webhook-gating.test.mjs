import test from 'node:test';
import assert from 'node:assert/strict';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
import {paidWebhookStore,paidWebhookCommitEnabled} from '../src/seat-webhook-environment.js';
const PROD='wheeling-miners.myshopify.com';
const TEST='wheeling-miners-ticket-testing.myshopify.com';
const base={WM_ENVIRONMENT:'PRODUCTION',SHOPIFY_STORE_DOMAIN:PROD,SEAT_PAID_FULFILLMENT_ENABLED:'true'};
test('production commits remain gated until both approvals',()=>{
 assert.equal(paidWebhookCommitEnabled(base,'123'),false);
 assert.equal(paidWebhookCommitEnabled({...base,SEAT_PUBLIC_SALES_APPROVED:'true'},'123'),false);
 assert.equal(paidWebhookCommitEnabled({...base,SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true'},'123'),false);
 assert.equal(paidWebhookCommitEnabled({...base,SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true'},'123'),true);
});
test('production and TEST shops cannot cross environments',()=>{
 assert.equal(paidWebhookStore({...base,SHOPIFY_STORE_DOMAIN:TEST}),null);
 assert.equal(paidWebhookStore({...base,WM_ENVIRONMENT:'TEST'}),null);
 assert.equal(paidWebhookStore({...base,WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:TEST}),TEST);
});
test('unsigned request is rejected before any database read',async()=>{
 const response=await handleShopifyPaidWebhook(new Request('https://example.com/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-shop-domain':PROD},body:'{}'}),{...base,SHOPIFY_WEBHOOK_SECRET:'not-a-real-secret',SEAT_DB:{prepare(){throw Error('DB MUST NOT BE READ')}}});
 assert.equal(response.status,401);
});
test('missing webhook configuration fails closed',async()=>{
 const response=await handleShopifyPaidWebhook(new Request('https://example.com/api/seats/webhooks/shopify',{method:'POST',body:'{}'}),base);
 assert.equal(response.status,503);
});
