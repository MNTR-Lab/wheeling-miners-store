/** Read existing production order/payment data only. Never creates or captures a payment.
 * Uses the same REST API version and order/transaction reads as the deployed paid webhook.
 * This checks GitHub app credentials; it does not execute production fulfillment.
 */
import {pathToFileURL} from 'node:url';
const SHOP='186815-4c.myshopify.com',API='2026-10';
const check=(ok,message)=>{if(!ok)throw Error(message)};
export async function verifyProductionPaymentReads(env,{fetchImpl=fetch,log=console.log}={}){
 check(env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN===SHOP,'Incorrect production Shopify store');
 check(typeof env.WM_SHOPIFY_CLIENT_ID==='string'&&env.WM_SHOPIFY_CLIENT_ID.length>0&&typeof env.WM_SHOPIFY_CLIENT_SECRET==='string'&&env.WM_SHOPIFY_CLIENT_SECRET.length>0,'Missing existing Shopify app credentials');
 let orderId=env.WM_VERIFY_ORDER_ID||'';
 check(orderId===''||/^[1-9]\d*$/.test(orderId),'Optional order ID must be the numeric Shopify order ID, not its display number or URL');
 async function request(path,options={}){
  let response;try{response=await fetchImpl(`https://${SHOP}${path}`,{...options,redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw Error('Shopify payment-read network request failed')}
  check(response.ok,`Shopify ${path.includes('access_token')?'authentication':path.includes('transactions.json')?'transaction read':'order read'} failed HTTP ${response.status}; check app installation and order-data permissions`);
  try{return await response.json()}catch{throw Error('Shopify payment-read response was not JSON')}
 }
 const auth=await request('/admin/oauth/access_token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.WM_SHOPIFY_CLIENT_ID,client_secret:env.WM_SHOPIFY_CLIENT_SECRET}).toString()});
 check(typeof auth.access_token==='string'&&auth.access_token.length>0,'Shopify access token missing');
 check(typeof auth.scope==='string'&&auth.scope.split(',').map(x=>x.trim()).includes('read_orders'),'Shopify app lacks read_orders');
 const options={method:'GET',headers:{'x-shopify-access-token':auth.access_token,accept:'application/json'}};
 if(!orderId){
  const list=await request(`/admin/api/${API}/orders.json?status=any&financial_status=paid&limit=1&fields=id`,options);
  check(Array.isArray(list.orders),'Shopify order list was invalid');
  check(list.orders.length>0,'Order list is accessible but no paid order was found. Supply an existing recent paid order ID; do not create or pay an order for this check');
  const id=list.orders[0]?.id;
  check(typeof id==='string'||Number.isSafeInteger(id),'Order ID is not safely representable');
  orderId=String(id);check(/^[1-9]\d*$/.test(orderId),'Shopify returned invalid order ID');
 }
 const result=await request(`/admin/api/${API}/orders/${orderId}.json?status=any&fields=id,financial_status`,options);
 check(String(result.order?.id)===orderId,'Shopify order identity mismatch');
 check(result.order.financial_status==='paid','Selected order is not currently paid; choose an existing paid order');
 log('PASS: actual production paid-order read succeeded (identity withheld)');
 const tx=await request(`/admin/api/${API}/orders/${orderId}/transactions.json?fields=id,kind,status,processed_at,created_at,amount`,options);
 check(Array.isArray(tx.transactions),'Shopify transaction list was invalid');
 const successful=tx.transactions.filter(t=>t?.status==='success'&&['sale','capture'].includes(t.kind));
 check(successful.length>0,'Transactions are accessible but no successful sale/capture was found; payment timestamp verification remains unproven');
 const times=successful.map(t=>t.processed_at||t.created_at).filter(t=>typeof t==='string'&&/^\d{4}-\d\d-\d\dT/.test(t)&&Number.isFinite(Date.parse(t)));
 check(times.length>0,'Successful transaction has no usable payment timestamp');
 log('PASS: actual production transaction read and successful payment timestamp available');
 log('NOT VERIFIED: Worker protected order reads, ticket reservation linkage, real ticket fulfillment, customer receipt, or launch readiness');
 log('SAFE: no payments, orders, seats, inventory, or feature flags changed; no customer/payment details printed');
 return {ok:true,paidOrderReadVerified:true,transactionReadVerified:true,paymentTimestampAvailable:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){verifyProductionPaymentReads(process.env).catch(error=>{console.error('FAIL: '+error.message);process.exitCode=1})}
