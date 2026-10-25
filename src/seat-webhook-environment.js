/** Explicit store and environment authorization for paid-seat webhook handling.
 * Production activation requires independent fulfillment and approval flags.
 * Never accept the TEST store in production, or production in TEST.
 */
const TEST_SHOP='wheeling-miners-ticket-testing.myshopify.com';
const DOMAIN=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export function paidWebhookStore(env){
 const shop=env?.SHOPIFY_STORE_DOMAIN;
 if(typeof shop!=='string'||!DOMAIN.test(shop))return null;
 if(env.WM_ENVIRONMENT==='TEST')return shop===TEST_SHOP?shop:null;
 if(env.WM_ENVIRONMENT==='PRODUCTION')return shop!==TEST_SHOP?shop:null;
 return null;
}
export function paidWebhookCommitEnabled(env,orderId){
 const shop=paidWebhookStore(env);
 if(!shop||env?.SEAT_PAID_FULFILLMENT_ENABLED!=='true')return false;
 if(env.WM_ENVIRONMENT==='PRODUCTION')return env.SEAT_PRODUCTION_PAID_COMMIT_APPROVED==='true'&&env.SEAT_PUBLIC_SALES_APPROVED==='true';
 return env.SEAT_TEST_AUTO_PAID_ENABLED==='true'||(env.SEAT_TEST_PAID_ORDER_ID==='18970068058169'&&String(orderId)==='18970068058169');
}
