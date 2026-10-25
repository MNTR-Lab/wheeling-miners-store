/** Restricted TEST-only recovery of an existing Shopify paid order.
 * Invoked exclusively behind seat-admin.js bearer authentication.
 * No production support; one order allowlisted; never trusts caller order payload.
 */
import {loadPaidCommitPlan} from './seat-shopify-webhook.js';
import {executePaidCommit} from './seat-paid-commit.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const ORDER='18970068058169';
export async function handleSeatOrderRecovery(request,env,{fetchImpl=fetch}={}){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env.WM_ENVIRONMENT!=='TEST'||env.SHOPIFY_STORE_DOMAIN!==SHOP||env.SEAT_TEST_PAID_ORDER_ID!==ORDER||env.SEAT_PAID_FULFILLMENT_ENABLED!=='true')return reply({error:'TEST_RECOVERY_DISABLED'},423);
 if(!env.SEAT_DB?.prepare||!env.SEAT_DB?.batch)return reply({error:'DATABASE_UNAVAILABLE'},503);
 if(!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)return reply({error:'SHOPIFY_CREDENTIALS_MISSING'},503);
 let input;try{const raw=await request.text();if(raw.length>512)return reply({error:'BODY_TOO_LARGE'},413);input=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400)}
 if(!input||Object.keys(input).sort().join(',')!=='commit,orderId'||input.orderId!==ORDER||typeof input.commit!=='boolean')return reply({error:'INVALID_RECOVERY_REQUEST'},422);
 try{
  const tokenResponse=await fetchImpl(`https://${SHOP}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET}).toString()});
  if(!tokenResponse.ok){console.error('Recovery token HTTP',tokenResponse.status);return reply({error:'SHOPIFY_TOKEN_EXCHANGE_FAILED',http_status:tokenResponse.status},503)}
  const token=await tokenResponse.json();
  if(typeof token.access_token!=='string'||token.access_token.length<8)return reply({error:'SHOPIFY_TOKEN_INVALID'},503);
  const scopes=typeof token.scope==='string'?token.scope.split(',').map(s=>s.trim()):[];
  if(!scopes.includes('read_orders'))return reply({error:'SHOPIFY_READ_ORDERS_SCOPE_MISSING'},503);
  const response=await fetchImpl(`https://${SHOP}/admin/api/2026-10/orders/${ORDER}.json?status=any`,{headers:{'x-shopify-access-token':token.access_token,'accept':'application/json'}});
  if(!response.ok){console.error('Recovery order HTTP',response.status);return reply({error:'SHOPIFY_ORDER_FETCH_FAILED',http_status:response.status},503)}
  const data=await response.json(),order=data?.order;
  if(String(order?.id)!==ORDER||order.financial_status!=='paid'||typeof order.paid_at!=='string'||!Number.isFinite(Date.parse(order.paid_at)))return reply({error:'SHOPIFY_PAID_ORDER_NOT_VERIFIED'},409);
  const plan=await loadPaidCommitPlan(order,env.SEAT_DB,{verifiedPaidWebhook:true});
  if(plan.ignored||plan.orderId!==ORDER)return reply({error:'ORDER_NOT_ELIGIBLE'},409);
  if(!input.commit)return reply({ok:true,mode:'PREVIEW',order_id:ORDER,seat_count:plan.seatCount,replayed:!!plan.replayed,ready:true});
  // Ownership is established by the fresh, authenticated Shopify Admin API
  // lookup and loadPaidCommitPlan; the commit function's verification flag
  // is used only after both checks pass, not for caller-provided data.
  const result=await executePaidCommit(env.SEAT_DB,plan,{signatureVerified:true});
  return reply({ok:true,mode:'COMMITTED',order_id:ORDER,seat_count:result.seatCount,replayed:!!result.replayed});
 }catch(error){console.error('Order recovery rejected',error?.message);return reply({error:'ORDER_RECOVERY_REJECTED',reason:error?.message??'UNKNOWN'},409)}
}
