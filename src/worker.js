import { handleSeatApi } from './seat-api.js';
import { handleSeatAdmin } from './seat-admin.js';
import { handleShopifyPaidWebhook } from './seat-shopify-webhook.js';
/** V82: verified Shopify webhook intake routed before the public staging API.
 * No automatic fulfillment, sales, or public reservations enabled.
 */
class AddLiveSeatScript {element(element){element.append('<script src="/assets/seat-live.js" defer></script>',{html:true});}}
const errorResponse=()=>new Response(JSON.stringify({error:'Seat service temporarily unavailable'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/seats/webhooks/shopify'){
   try{return await handleShopifyPaidWebhook(request,env);}catch(error){console.error('Seat webhook error',error);return errorResponse();}
  }
  if(url.pathname.startsWith('/api/seats/admin/')){
   try{return (await handleSeatAdmin(request,env))??new Response('Not found',{status:404});}
   catch(error){console.error('Seat admin error',error);return errorResponse();}
  }
  if(url.pathname.startsWith('/api/seats/')){
   try{return (await handleSeatApi(request,env))??new Response('Not found',{status:404});}
   catch(error){console.error('Seat API error',error);return errorResponse();}
  }
  const response=await env.ASSETS.fetch(request);
  if(request.method==='GET'&&response.ok&&(/^\/seat-selector(?:\.html)?\/?$/.test(url.pathname))){
   return new HTMLRewriter().on('body',new AddLiveSeatScript()).transform(response);
  }
  return response;
 }
};
