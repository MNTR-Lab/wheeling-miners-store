/** Test-only Shopify Admin verification mock. No external calls. */
import {handleShopifyPaidWebhook as productionHandler} from '../../src/seat-shopify-webhook.js';
export const SHOP='wheeling-miners-ticket-testing.myshopify.com';
export function testEnv(env){return {...env,WM_ENVIRONMENT:'TEST',SHOPIFY_STORE_DOMAIN:SHOP,SHOPIFY_CLIENT_ID:'fixture-client',SHOPIFY_CLIENT_SECRET:'fixture-secret',SEAT_TEST_AUTO_PAID_ENABLED:'true'};}
export function signedShopifyRequest(request){const headers=new Headers(request.headers);headers.set('x-shopify-shop-domain',SHOP);return new Request(request,{headers});}
export async function handleShopifyPaidWebhook(request,env,opts={}){
 const body=await request.clone().json();
 const id=String(body.id??123);
 const fetchImpl=async url=>{
  if(url.endsWith('/admin/oauth/access_token'))return Response.json({access_token:'fixture-access-token',scope:'read_orders'});
  if(url.includes('/transactions.json'))return Response.json({transactions:[{kind:'sale',status:'success',processed_at:'2026-10-25T12:00:00Z'}]});
  if(url.includes('/orders/'))return Response.json({order:{id:Number(id),financial_status:'paid'}});
  throw Error('UNEXPECTED_SHOPIFY_TEST_REQUEST');
 };
 return productionHandler(signedShopifyRequest(request),testEnv(env),{...opts,fetchImpl});
}
