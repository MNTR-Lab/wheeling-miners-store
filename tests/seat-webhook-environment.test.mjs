import test from 'node:test';
import assert from 'node:assert/strict';
import {paidWebhookStore,paidWebhookCommitEnabled} from '../src/seat-webhook-environment.js';
const TEST='wheeling-miners-ticket-testing.myshopify.com';
const PROD='wheeling-miners.myshopify.com';
const base={WM_ENVIRONMENT:'PRODUCTION',SHOPIFY_STORE_DOMAIN:PROD,SEAT_PAID_FULFILLMENT_ENABLED:'true'};
test('production requires two independent approvals',()=>{
 for(const opts of [{},{SEAT_PUBLIC_SALES_APPROVED:'true'},{SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true'}])assert.equal(paidWebhookCommitEnabled({...base,...opts},'123'),false);
 assert.equal(paidWebhookCommitEnabled({...base,SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true'},'123'),true);
});
test('production never accepts test store',()=>assert.equal(paidWebhookStore({...base,SHOPIFY_STORE_DOMAIN:TEST}),null));
test('test never accepts production store',()=>assert.equal(paidWebhookStore({WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:PROD}),null));
test('test auto paid remains test-only',()=>{
 assert.equal(paidWebhookCommitEnabled({WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:TEST,SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_TEST_AUTO_PAID_ENABLED:'true'},'123'),true);
 assert.equal(paidWebhookCommitEnabled({...base,SEAT_TEST_AUTO_PAID_ENABLED:'true'},'123'),false);
});
test('unknown environments and invalid domains fail closed',()=>{
 for(const domain of ['', 'evil.example.com', 'WHEElING.myshopify.com',TEST+'.evil.com'])assert.equal(paidWebhookStore({...base,SHOPIFY_STORE_DOMAIN:domain}),null);
 assert.equal(paidWebhookStore({...base,WM_ENVIRONMENT:'STAGING'}),null);
});
