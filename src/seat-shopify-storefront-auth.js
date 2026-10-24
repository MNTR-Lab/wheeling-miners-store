/** Admin-authenticated, read-only Shopify Storefront connection diagnostic. */
const HOST = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply = (body,status) => new Response(JSON.stringify(body),{status,headers:HEADERS});

export async function verifyShopifyStorefrontConnection(env,{fetchImpl=fetch}={}) {
  const shop = env?.SHOPIFY_STORE_DOMAIN;
  const token = env?.SHOPIFY_STOREFRONT_TOKEN;
  if(typeof shop!=='string'||!HOST.test(shop)||typeof token!=='string'||token.length<10) {
    throw new Error('SHOPIFY_STOREFRONT_NOT_CONFIGURED');
  }
  const response = await fetchImpl(`https://${shop}/api/2026-10/graphql.json`,{
    method:'POST',
    headers:{'content-type':'application/json','Shopify-Storefront-Private-Token':token},
    body:JSON.stringify({query:'query WheelingStorefrontConnection { shop { name } }'})
  });
  if(!response?.ok)throw new Error(`SHOPIFY_STOREFRONT_HTTP_${response?.status||'ERROR'}`);
  const payload = await response.json();
  if(payload?.errors?.length)throw new Error('SHOPIFY_STOREFRONT_GRAPHQL_REJECTED');
  if(typeof payload?.data?.shop?.name!=='string'||!payload.data.shop.name.trim())throw new Error('SHOPIFY_STOREFRONT_UNEXPECTED_RESPONSE');
  return {connected:true,shop,storeName:payload.data.shop.name,readOnly:true,cartCreated:false,inventoryChanged:false,publicCheckoutEnabled:false};
}

export async function handleShopifyStorefrontConnection(request,env,{fetchImpl=fetch}={}) {
  if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
  if(env?.SEAT_SHOPIFY_AUTH_PROBE_ENABLED!=='true')return reply({error:'AUTH_PROBE_DISABLED'},423);
  try{return reply(await verifyShopifyStorefrontConnection(env,{fetchImpl}),200)}
  catch(e){console.error('Storefront diagnostic failed:',e?.message);return reply({error:'SHOPIFY_STOREFRONT_CONNECTION_FAILED',reason:e?.message},503)}
}
