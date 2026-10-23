/** Read-only Shopify Admin authentication and connection verification. */
const SHOP=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const VERSION='2026-10';
const fail=(code)=>{throw new Error(code)};
export async function verifyShopifyAdminConnection(env,{fetchImpl=fetch}={}){
 const shop=env?.SHOPIFY_STORE_DOMAIN,clientId=env?.SHOPIFY_CLIENT_ID,clientSecret=env?.SHOPIFY_CLIENT_SECRET;
 if(!SHOP.test(shop??'')||typeof clientId!=='string'||!clientId.trim()||typeof clientSecret!=='string'||!clientSecret.trim())fail('SHOPIFY_ADMIN_NOT_CONFIGURED');
 const tokenResponse=await fetchImpl(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}).toString()});
 if(!tokenResponse?.ok)fail('SHOPIFY_TOKEN_EXCHANGE_FAILED');
 const tokenData=await tokenResponse.json();
 if(typeof tokenData?.access_token!=='string'||tokenData.access_token.length<8)fail('SHOPIFY_TOKEN_INVALID');
 const scopes=typeof tokenData.scope==='string'?tokenData.scope.split(',').map(s=>s.trim()).filter(Boolean):[];
 if(!scopes.includes('read_products'))fail('SHOPIFY_READ_PRODUCTS_SCOPE_MISSING');
 const response=await fetchImpl(`https://${shop}/admin/api/${VERSION}/graphql.json`,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':tokenData.access_token},body:JSON.stringify({query:'query WheelingTicketConnection { shop { name myshopifyDomain } }'})});
 if(!response?.ok)fail('SHOPIFY_ADMIN_QUERY_FAILED');
 const payload=await response.json();
 if(payload?.errors?.length||payload?.data?.shop?.myshopifyDomain!==shop)fail('SHOPIFY_ADMIN_SHOP_MISMATCH');
 return {connected:true,shop:payload.data.shop.myshopifyDomain,storeName:payload.data.shop.name,scopes,tokenExpiresInSeconds:typeof tokenData.expires_in==='number'?tokenData.expires_in:null,readOnly:true,checkoutEnabled:false};
}
export async function handleShopifyAdminConnection(request,env,{fetchImpl=fetch}={}){
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
 const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers});
 if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env?.SEAT_SHOPIFY_AUTH_PROBE_ENABLED!=='true')return reply({error:'AUTH_PROBE_DISABLED'},423);
 try{return reply(await verifyShopifyAdminConnection(env,{fetchImpl}),200)}catch(e){console.error('Shopify admin connection failed',e?.message);return reply({error:'SHOPIFY_CONNECTION_FAILED',reason:e?.message},503)}
}
