/** TEST Shopify authentication diagnostic. No token or credential is printed. */
import fs from 'node:fs';
const shop='wheeling-miners-ticket-testing.myshopify.com';
const clientId=process.env.WM_SHOPIFY_CLIENT_ID;
const clientSecret=process.env.WM_SHOPIFY_CLIENT_SECRET;
const report=['## Wheeling Shopify TEST authentication diagnostic','',`- Target store: ${shop}`];
const add=(label,value)=>report.push(`- ${label}: ${value}`);
if(!clientId||!clientSecret){add('Result','GITHUB_SECRETS_MISSING');process.exitCode=1;}
else {
 try {
  const r=await fetch(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(15000)});
  add('HTTP status',r.status);
  let body={};try{body=await r.json()}catch{}
  if(r.ok&&typeof body.access_token==='string'){
   add('Result','TOKEN_ISSUED');
   const scopes=String(body.scope??'').split(',').map(x=>x.trim());
   add('read_orders scope',scopes.includes('read_orders')?'PRESENT':'NOT_LISTED');
   add('read_products scope',scopes.includes('read_products')?'PRESENT':'NOT_LISTED');
  }else{
   const known=['invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_request','access_denied'];
   const code=typeof body.error==='string'&&known.includes(body.error)?body.error:'UNCLASSIFIED_SHOPIFY_RESPONSE';
   add('OAuth error code',code);
   add('Result','TOKEN_NOT_ISSUED');
   process.exitCode=1;
  }
 }catch(e){add('Result',e?.name==='TimeoutError'?'REQUEST_TIMEOUT':'NETWORK_REQUEST_FAILED');process.exitCode=1;}
}
report.push('','**Read-only: no Shopify orders, payments, or Cloudflare data changed. No credentials or tokens were logged.**');
const summary=report.join('\n')+'\n';
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
