/** Read-only deployed payment audit. No seat-bearing payloads, deployments, or flag writes. */
import {createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const PRODUCTION_ORIGIN='https://wheeling-miners-store.bikard.workers.dev';
export const PRODUCTION_SHOP='186815-4c.myshopify.com';
const ACCOUNT='0b83177a971bd8fcfad88ed4e531eb50';
const DATABASE='221e3797-3ea2-477d-9a7f-7dfded620547';
const ACTIVATION=['SEAT_PAID_FULFILLMENT_ENABLED','SEAT_PUBLIC_SALES_APPROVED','SEAT_PRODUCTION_PAID_COMMIT_APPROVED','SEAT_PUBLIC_SALES_ENABLED','SEAT_CONTROLLED_CART_ENABLED'];
const REQUIRED=['SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_WEBHOOK_SECRET','SHOPIFY_STORE_DOMAIN','WM_ENVIRONMENT'];
const check=(ok,message)=>{if(!ok)throw Error(message)};
export function verifyLockedBindings(bindings){
 check(Array.isArray(bindings),'Worker settings did not return bindings');
 const byName=new Map();
 for(const binding of bindings){check(binding&&typeof binding.name==='string'&&!byName.has(binding.name),'Invalid or duplicate Worker binding');byName.set(binding.name,binding)}
 check(byName.get('SEAT_DB')?.type==='d1'&&byName.get('SEAT_DB').id===DATABASE,'Production database binding mismatch');
 for(const name of REQUIRED){const b=byName.get(name);check(b&&['plain_text','secret_text'].includes(b.type),`Missing runtime binding: ${name}`);if(b.type==='plain_text')check(typeof b.text==='string'&&b.text.length>0,`Empty runtime binding: ${name}`)}
 for(const name of ACTIVATION){const b=byName.get(name);if(!b)continue;check(b.type==='plain_text',`Cannot independently inspect activation flag: ${name}`);check(b.text!=='true',`Production activation flag is enabled: ${name}`)}
 const environment=byName.get('WM_ENVIRONMENT'),shop=byName.get('SHOPIFY_STORE_DOMAIN');
 if(environment.type==='plain_text')check(environment.text==='PRODUCTION','Production environment mismatch');
 if(shop.type==='plain_text')check(shop.text===PRODUCTION_SHOP,'Production store mismatch');
 return true;
}
export async function auditProductionPaymentRuntime(env,{fetchImpl=fetch,log=console.log}={}){
 check(env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT,'Incorrect Cloudflare account');
 check(typeof env.CLOUDFLARE_API_TOKEN==='string'&&env.CLOUDFLARE_API_TOKEN.length>0,'Missing Cloudflare token');
 check(env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN===PRODUCTION_SHOP,'Incorrect production Shopify store');
 check(typeof env.WM_WEBHOOK_SIGNING_SECRET==='string'&&env.WM_WEBHOOK_SIGNING_SECRET.length>0,'Missing Shopify app signing secret');
 const origin=env.WM_PRODUCTION_WORKER_URL||PRODUCTION_ORIGIN;
 check(origin===PRODUCTION_ORIGIN||origin===PRODUCTION_ORIGIN+'/','Unexpected production Worker URL');
 async function request(url,options={}){
  let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw Error('Audit network request failed; no checks were skipped')}
  let body;try{body=await response.json()}catch{throw Error('Audit endpoint did not return JSON')}
  return {response,body};
 }
 const settings=await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/wheeling-miners-store/settings`,{headers:{authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`}});
 check(settings.response.ok&&settings.body.success===true,'Production Worker settings read failed');
 verifyLockedBindings(settings.body.result?.bindings);
 log('PASS: correct production database, required binding names present, activation flags off');
 const get=(path,options)=>request(PRODUCTION_ORIGIN+path,options);
 const status=await get('/api/seats/status');
 check(status.response.status===200&&status.body.checkout_enabled===false&&status.body.holds_enabled===false,'Production status does not confirm locked sales');
 for(const path of ['/api/seats/hold','/api/seats/checkout']){
  const r=await get(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  check(r.response.status===423,'Production public purchase endpoint is not locked: '+path);
 }
 log('PASS: deployed public holds and checkout locked');
 const path='/api/seats/webhooks/shopify';
 const method=await get(path);check(method.response.status===405,'Webhook GET must reject unsupported method');
 // This payload has no seat SKUs and must be ignored before any database access.
 const raw=JSON.stringify({id:'1',line_items:[],note_attributes:[]});
 const signature=createHmac('sha256',env.WM_WEBHOOK_SIGNING_SECRET).update(raw).digest('base64');
 const headers={'content-type':'application/json','x-shopify-topic':'orders/paid','x-shopify-shop-domain':PRODUCTION_SHOP};
 const unsigned=await get(path,{method:'POST',headers,body:raw});
 check(unsigned.response.status===401,'Unsigned webhook was not rejected');
 const signed=await get(path,{method:'POST',headers:{...headers,'x-shopify-hmac-sha256':signature},body:raw});
 check(signed.response.status===200&&signed.body.ok===true&&signed.body.ignored===true&&signed.body.reason==='NO_ASSIGNED_SEATS','Signed non-seat probe failed; verify deployed integration, production environment/store, and Shopify app signing secret');
 for(const shop of ['wheeling-miners-ticket-testing.myshopify.com','unrelated-shop.myshopify.com']){
  const wrong=await get(path,{method:'POST',headers:{...headers,'x-shopify-shop-domain':shop,'x-shopify-hmac-sha256':signature},body:raw});
  check(wrong.response.status===403,'Webhook did not reject wrong Shopify store');
 }
 log('PASS: deployed production store routing and HMAC verification; TEST and unrelated stores rejected');
 log('NOT VERIFIED: real payment, fulfillment transaction, payment gateway, taxes, or storefront publication');
 log('SAFE: no seats, inventory, sales flags, or deployments modified');
 return {ok:true,productionSalesLocked:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 auditProductionPaymentRuntime(process.env).catch(error=>{console.error('FAIL: '+error.message);console.error('Production payment audit did not pass. No activation attempted.');process.exitCode=1});
}
