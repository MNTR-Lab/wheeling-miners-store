import { handleSeatApi } from './seat-api.js';

/** V38: existing storefront remains static; read-only seat status is injected
 * into the selector to prevent misleading green/available seats in staging. */
class AddLiveSeatScript {
 element(element){element.append('<script src="/assets/seat-live.js" defer></script>',{html:true});}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/seats/')){
   try{return (await handleSeatApi(request,env))??new Response('Not found',{status:404});}
   catch(error){console.error('Seat API error',error);return new Response(JSON.stringify({error:'Seat inventory temporarily unavailable'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  }
  const response=await env.ASSETS.fetch(request);
  if(request.method==='GET'&&response.ok&&(/^\/seat-selector(?:\.html)?\/?$/.test(url.pathname))){
   return new HTMLRewriter().on('body',new AddLiveSeatScript()).transform(response);
  }
  return response;
 }
};
