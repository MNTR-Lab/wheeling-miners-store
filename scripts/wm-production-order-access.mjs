/** Read-only check of GitHub credentials and the production Worker's own Admin credentials.
 * No payment, order, inventory, or activation mutations.
 */
import {pathToFileURL} from 'node:url';
import {verifyShopifyAdminConnection} from '../src/seat-shopify-admin-auth.js';
const SHOP='186815-4c.myshopify.com';
const ORIGIN='https://wheeling-miners-store.bikard.workers.dev';
const check=(ok,message)=>{if(!ok)throw Error(message)};
export async function auditProductionOrderAccess(env,{fetchImpl=fetch,log=console.log}={}){
 check(env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN===SHOP,'Incorrect production Shopify store');
 check(typeof env.WM_SEAT_ADMIN_TOKEN==='string'&&env.WM_SEAT_ADMIN_TOKEN.length>0,'Add GitHub secret WM_SEAT_ADMIN_TOKEN using the existing production SEAT_ADMIN_TOKEN');
 check(typeof env.WM_SHOPIFY_CLIENT_ID==='string'&&env.WM_SHOPIFY_CLIENT_ID.length>0&&typeof env.WM_SHOPIFY_CLIENT_SECRET==='string'&&env.WM_SHOPIFY_CLIENT_SECRET.length>0,'Missing existing GitHub Shopify app credentials');
 const fetchSafe=async(url,options={})=>{try{return await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw Error('Order-access network request failed')}};
 let connection;
 try{connection=await verifyShopifyAdminConnection({SHOPIFY_STORE_DOMAIN:SHOP,SHOPIFY_CLIENT_ID:env.WM_SHOPIFY_CLIENT_ID,SHOPIFY_CLIENT_SECRET:env.WM_SHOPIFY_CLIENT_SECRET},{fetchImpl:fetchSafe})}catch{throw Error('GitHub Shopify authentication or read_products verification failed; credential values withheld')}
 check(connection.connected===true&&connection.shop===SHOP,'GitHub Shopify store identity mismatch');
 check(connection.scopes.includes('read_orders'),'GitHub Shopify app lacks read_orders; update the installed app scopes before any payment test');
 log('PASS: GitHub app authenticates to GOAT production store with read_products and read_orders');
 const response=await fetchSafe(ORIGIN+'/api/seats/admin/shopify-connection',{headers:{authorization:'Bearer '+env.WM_SEAT_ADMIN_TOKEN,accept:'application/json'}});
 if(response.status===401||response.status===403)throw Error('Production admin authentication rejected WM_SEAT_ADMIN_TOKEN; use the existing production SEAT_ADMIN_TOKEN');
 if(response.status===423)throw Error('Production auth probe is disabled. Set production Worker SEAT_SHOPIFY_AUTH_PROBE_ENABLED=true; keep all sales and fulfillment flags disabled');
 check(response.ok,'Production Worker Shopify connection probe failed; verify its SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET match the installed production app');
 let body;try{body=await response.json()}catch{throw Error('Worker connection probe returned invalid JSON')}
 check(body?.connected===true&&body.shop===SHOP&&body.readOnly===true,'Production Worker did not confirm the expected Shopify store');
 check(Array.isArray(body.scopes)&&body.scopes.includes('read_products')&&body.scopes.includes('read_orders'),'Production Worker app lacks read_products or read_orders');
 log('PASS: production Worker independently authenticates using its own stored credentials and reports read_orders');
 log('NOT VERIFIED: protected order/transaction reads, real payment, seat fulfillment, gateway/tax settings, or storefront publication');
 log('SAFE: no orders, inventory, payments, or sales flags changed');
 return {ok:true,workerAuthenticationVerified:true,orderScopePresent:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){auditProductionOrderAccess(process.env).catch(error=>{console.error('FAIL: '+error.message);process.exitCode=1})}
