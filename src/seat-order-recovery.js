/** Restricted TEST-only Shopify paid-order recovery.
 * Reads only the minimum order fields required and verifies payment time from
 * successful sale/capture transactions. Shopify Order objects do not reliably
 * expose a `paid_at` field; the verified transaction timestamp is supplied to
 * the existing ownership validator as the internal `paid_at` value.
 * No customer name, email, phone, or address is requested.
 */
import {loadPaidCommitPlan} from './seat-shopify-webhook.js';
import {executePaidCommit} from './seat-paid-commit.js';

const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const ORDER='18970068058169';

function safeError(body){
 const s=String(body||'').toLowerCase();
 if(s.includes('protected customer data'))return 'PROTECTED_CUSTOMER_DATA';
 if(s.includes('access denied')||s.includes('access_denied'))return 'ACCESS_DENIED';
 if(s.includes('scope')||s.includes('permission'))return 'SCOPE_OR_PERMISSION';
 if(s.includes('not found'))return 'NOT_FOUND';
 if(s.includes('deprecated')||s.includes('rest admin api'))return 'REST_API_RESTRICTED';
 return 'UNCLASSIFIED';
}

function validTimestamp(value){
 if(typeof value!=='string')return false;
 const n=Date.parse(value);
 return Number.isFinite(n);
}

export async function handleSeatOrderRecovery(request,env,{fetchImpl=fetch}={}){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env.WM_ENVIRONMENT!=='TEST'||env.SHOPIFY_STORE_DOMAIN!==SHOP||env.SEAT_TEST_PAID_ORDER_ID!==ORDER||env.SEAT_PAID_FULFILLMENT_ENABLED!=='true')return reply({error:'TEST_RECOVERY_DISABLED'},423);
 if(!env.SEAT_DB?.prepare||!env.SEAT_DB?.batch)return reply({error:'DATABASE_UNAVAILABLE'},503);
 if(!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)return reply({error:'SHOPIFY_CREDENTIALS_MISSING'},503);

 let input;
 try{
  const raw=await request.text();
  if(raw.length>512)return reply({error:'BODY_TOO_LARGE'},413);
  input=JSON.parse(raw);
 }catch{return reply({error:'INVALID_JSON'},400);}
 if(!input||Object.keys(input).sort().join(',')!=='commit,orderId'||input.orderId!==ORDER||typeof input.commit!=='boolean')return reply({error:'INVALID_RECOVERY_REQUEST'},422);

 try{
  const tokenResponse=await fetchImpl(`https://${SHOP}/admin/oauth/access_token`,{
   method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({
    grant_type:'client_credentials',
    client_id:env.SHOPIFY_CLIENT_ID,
    client_secret:env.SHOPIFY_CLIENT_SECRET
   }).toString()
  });
  if(!tokenResponse.ok)return reply({error:'SHOPIFY_TOKEN_EXCHANGE_FAILED',http_status:tokenResponse.status},503);
  const token=await tokenResponse.json();
  if(typeof token.access_token!=='string'||token.access_token.length<8)return reply({error:'SHOPIFY_TOKEN_INVALID'},503);
  const scopes=typeof token.scope==='string'?token.scope.split(',').map(s=>s.trim()):[];
  if(!scopes.includes('read_orders'))return reply({error:'SHOPIFY_READ_ORDERS_SCOPE_MISSING'},503);

  // Minimize requested fields: no customer object, email, phone, or addresses.
  const orderUrl=`https://${SHOP}/admin/api/2026-10/orders/${ORDER}.json?status=any&fields=id,financial_status,line_items,note_attributes`;
  const orderResponse=await fetchImpl(orderUrl,{
   headers:{'x-shopify-access-token':token.access_token,'accept':'application/json'}
  });
  if(!orderResponse.ok){
   let body='';try{body=(await orderResponse.text()).slice(0,4096)}catch{}
   const requestId=orderResponse.headers?.get('x-request-id')||orderResponse.headers?.get('x-shopify-request-id')||null;
   const classification=safeError(body);
   console.error('Shopify order fetch rejected',{status:orderResponse.status,classification,requestId});
   return reply({error:'SHOPIFY_ORDER_FETCH_FAILED',http_status:orderResponse.status,classification,shopify_request_id:requestId},503);
  }

  const orderPayload=await orderResponse.json();
  const order=orderPayload?.order;
  if(String(order?.id)!==ORDER)return reply({error:'SHOPIFY_ORDER_ID_MISMATCH'},409);
  if(order.financial_status!=='paid')return reply({error:'SHOPIFY_ORDER_NOT_PAID',financial_status:typeof order.financial_status==='string'?order.financial_status:'unknown'},409);

  // Shopify's Order resource has no dependable `paid_at` property. Verify the
  // payment timestamp from successful SALE/CAPTURE transaction records instead.
  const txUrl=`https://${SHOP}/admin/api/2026-10/orders/${ORDER}/transactions.json?fields=id,kind,status,processed_at,created_at,amount`;
  const txResponse=await fetchImpl(txUrl,{
   headers:{'x-shopify-access-token':token.access_token,'accept':'application/json'}
  });
  if(!txResponse.ok){
   let body='';try{body=(await txResponse.text()).slice(0,4096)}catch{}
   const requestId=txResponse.headers?.get('x-request-id')||txResponse.headers?.get('x-shopify-request-id')||null;
   const classification=safeError(body);
   console.error('Shopify transaction fetch rejected',{status:txResponse.status,classification,requestId});
   return reply({error:'SHOPIFY_TRANSACTION_FETCH_FAILED',http_status:txResponse.status,classification,shopify_request_id:requestId},503);
  }
  const txPayload=await txResponse.json();
  const transactions=Array.isArray(txPayload?.transactions)?txPayload.transactions:[];
  const successfulPayments=transactions.filter(tx=>
   tx?.status==='success'&&['sale','capture'].includes(tx?.kind)&&
   validTimestamp(tx?.processed_at||tx?.created_at)
  );
  if(!successfulPayments.length)return reply({error:'SHOPIFY_PAID_TRANSACTION_NOT_VERIFIED'},409);

  // For split captures, use the latest successful capture/sale timestamp: this
  // is the earliest defensible point at which the order's final payment could
  // have been completed. Financial status must independently be "paid".
  successfulPayments.sort((a,b)=>
   Date.parse(a.processed_at||a.created_at)-Date.parse(b.processed_at||b.created_at)
  );
  const paymentTime=successfulPayments[successfulPayments.length-1].processed_at||
   successfulPayments[successfulPayments.length-1].created_at;
  order.paid_at=paymentTime;

  const plan=await loadPaidCommitPlan(order,env.SEAT_DB,{verifiedPaidWebhook:true});
  if(plan.ignored||plan.orderId!==ORDER)return reply({error:'ORDER_NOT_ELIGIBLE'},409);
  if(!input.commit)return reply({ok:true,mode:'PREVIEW',order_id:ORDER,seat_count:plan.seatCount,replayed:!!plan.replayed,ready:true});
  const result=await executePaidCommit(env.SEAT_DB,plan,{signatureVerified:true});
  return reply({ok:true,mode:'COMMITTED',order_id:ORDER,seat_count:result.seatCount,replayed:!!result.replayed});
 }catch(error){
  console.error('Order recovery rejected',error?.message);
  return reply({error:'ORDER_RECOVERY_REJECTED',reason:error?.message??'UNKNOWN'},409);
 }
}
