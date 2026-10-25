/** Production orders/paid webhook. No inventory or product writes. */
const shop=String(process.env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN||'').trim().toLowerCase();
const clientId=process.env.WM_SHOPIFY_CLIENT_ID, clientSecret=process.env.WM_SHOPIFY_CLIENT_SECRET;
const mode=process.env.WM_WEBHOOK_ACTION||'verify';
const endpoint='https://wheeling-miners-store.bikard.workers.dev/api/seats/webhooks/shopify';
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
assert(shop==='186815-4c.myshopify.com','Incorrect production Shopify store');
assert(clientId&&clientSecret,'Missing existing Shopify credentials');
assert(['verify','register'].includes(mode),'Invalid action');
const auth=await fetch(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}).toString()});
assert(auth.ok,'Shopify authentication failed HTTP '+auth.status);
const creds=await auth.json();assert(creds.access_token,'Missing access token');
console.log('Production Shopify authentication passed.');
async function gql(query,variables={}){
 const r=await fetch(`https://${shop}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'x-shopify-access-token':creds.access_token,'content-type':'application/json'},body:JSON.stringify({query,variables})});
 assert(r.ok,'Shopify GraphQL HTTP '+r.status);const body=await r.json();
 assert(!body.errors?.length,'Shopify GraphQL error '+JSON.stringify(body.errors));return body.data;
}
const list=async()=>{const out=[];let cursor=null;do{const data=await gql('query($after:String){webhookSubscriptions(first:100,after:$after){edges{node{id topic endpoint{__typename ... on WebhookHttpEndpoint{callbackUrl}}} cursor}pageInfo{hasNextPage}}}',{after:cursor});const page=data.webhookSubscriptions;out.push(...page.edges.map(x=>x.node));if(!page.pageInfo.hasNextPage)break;cursor=page.edges.at(-1)?.cursor;}while(cursor);return out};
let subscriptions=await list();let paid=subscriptions.filter(x=>x.topic==='ORDERS_PAID');let correct=paid.filter(x=>x.endpoint?.callbackUrl===endpoint);
console.log(`Paid subscriptions: ${paid.length}; matching production endpoint: ${correct.length}`);
if(mode==='register'&&correct.length===0){
 assert(paid.length===0,'A different orders/paid subscription already exists; refusing to overwrite or duplicate it.');
 const data=await gql('mutation($topic:WebhookSubscriptionTopic!,$subscription:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$subscription){webhookSubscription{id topic endpoint{__typename ... on WebhookHttpEndpoint{callbackUrl}}}userErrors{field message}}}',{topic:'ORDERS_PAID',subscription:{uri:endpoint}});
 const result=data.webhookSubscriptionCreate;
 assert(result&&!result.userErrors?.length,'Shopify rejected webhook: '+JSON.stringify(result?.userErrors));
 assert(result.webhookSubscription?.endpoint?.callbackUrl===endpoint,'Shopify did not confirm callback URL');
 console.log('Created production webhook subscription '+result.webhookSubscription.id);
 subscriptions=await list();paid=subscriptions.filter(x=>x.topic==='ORDERS_PAID');correct=paid.filter(x=>x.endpoint?.callbackUrl===endpoint);
}
assert(correct.length===1,'Expected one production paid webhook at specified endpoint, found '+correct.length);
console.log('PASS: production paid webhook subscription verified. No seats, products, or sales flags modified.');
