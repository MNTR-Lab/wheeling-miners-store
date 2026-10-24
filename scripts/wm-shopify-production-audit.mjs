/** Read-only cross-system production inventory audit. No Shopify or D1 mutations. */
const ACCOUNT='0b83177a971bd8fcfad88ed4e531eb50';
const DATABASE='221e3797-3ea2-477d-9a7f-7dfded620547';
const expected=3737;
const cfToken=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const shop=String(process.env.WM_SHOPIFY_PRODUCTION_STORE_DOMAIN||'').trim().toLowerCase();
const clientId=process.env.WM_SHOPIFY_CLIENT_ID;
const clientSecret=process.env.WM_SHOPIFY_CLIENT_SECRET;
function check(condition,message){if(!condition)throw Error(message)}
check(account===ACCOUNT,'Cloudflare account mismatch; aborting');
check(cfToken,'Missing CLOUDFLARE_API_TOKEN');
check(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop),'Set repository variable WM_SHOPIFY_PRODUCTION_STORE_DOMAIN to the actual production *.myshopify.com domain');
check(shop!=='wheeling-miners-ticket-testing.myshopify.com','Refusing to audit the TEST Shopify store as production');
check(clientId,'Missing GitHub Actions secret WM_SHOPIFY_CLIENT_ID');
check(clientSecret,'Missing GitHub Actions secret WM_SHOPIFY_CLIENT_SECRET');
async function getShopifyToken(){
 const body=new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret});
 const response=await fetch(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
 if(!response.ok)throw Error(`Shopify client credentials authentication failed (HTTP ${response.status}). Verify app installation and credentials.`);
 const data=await response.json();
 check(typeof data.access_token==='string'&&data.access_token.length>0,'Shopify did not return an Admin API access token');
 if(data.scope && !data.scope.split(',').map(s=>s.trim()).includes('read_products')) console.warn('NOTICE: Returned Shopify scopes do not explicitly include read_products');
 console.log('PASS: Shopify Admin API authentication succeeded (token withheld)');
 return data.access_token;
}
async function d1(sql){
 const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`,{method:'POST',headers:{Authorization:`Bearer ${cfToken}`,'content-type':'application/json'},body:JSON.stringify({sql})});
 const body=await res.json();
 check(res.ok&&body.success&&body.result?.[0]?.success,`Cloudflare D1 read failed (${res.status})`);
 return body.result[0].results;
}
const shopToken=await getShopifyToken();
const rows=await d1('SELECT sku,shopify_variant_id,price_cents,status FROM seats ORDER BY sku');
check(rows.length===expected,`Expected ${expected} production seats; found ${rows.length}`);
const skuSet=new Set(),variantSet=new Set();
for(const row of rows){
 check(typeof row.sku==='string'&&!skuSet.has(row.sku),'Duplicate/invalid D1 seat SKU');skuSet.add(row.sku);
 check(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(row.shopify_variant_id||''),'Invalid Shopify variant ID in D1');
 check(!variantSet.has(row.shopify_variant_id),'Duplicate Shopify variant ID in D1');variantSet.add(row.shopify_variant_id);
 check(Number.isSafeInteger(row.price_cents)&&row.price_cents>0,'Invalid D1 seat price');
 check(row.status==='UNRELEASED',`Production seat ${row.sku} is ${row.status}, expected UNRELEASED`);
}
console.log(`PASS: ${rows.length} unique production seats, unique mapped variants, positive prices, all UNRELEASED`);
const query=`query AuditVariants($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id sku price product{id status}}}}`;
async function graphql(ids){
 for(let attempt=0;attempt<4;attempt++){
  const response=await fetch(`https://${shop}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'X-Shopify-Access-Token':shopToken,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{ids}})});
  if((response.status===429||response.status>=500)&&attempt<3){await new Promise(r=>setTimeout(r,1500*(attempt+1)));continue}
  check(response.ok,`Shopify Admin API HTTP ${response.status}; verify production domain and app scopes`);
  const payload=await response.json();
  // Shopify may return GraphQL errors while HTTP status is 200. Never crash while reporting them.
  if(Array.isArray(payload.errors)&&payload.errors.length){
   const details=payload.errors.slice(0,3).map(e=>{
    const message=String(e?.message||'Unknown GraphQL error');
    const code=e?.extensions?.code ? ` [${e.extensions.code}]` : '';
    return `${message}${code}`;
   }).join('; ');
   throw Error(`Shopify GraphQL query rejected: ${details.slice(0,650)}. Check read_products scope and Shopify API query permissions.`);
  }
  check(Array.isArray(payload.data?.nodes)&&payload.data.nodes.length===ids.length,'Shopify variant query returned incomplete data');
  return payload.data.nodes;
 }
 throw Error('Shopify API unavailable after retries');
}
function cents(value){
 const text=String(value??'');
 check(/^\d+\.\d{2}$/.test(text),`Shopify price has unsupported format: ${text.slice(0,20)}`);
 const [d,c]=text.split('.');return Number(d)*100+Number(c);
}
let missing=0,skuMismatch=0,priceMismatch=0,nonActive=0;
const samples=[];
function issue(type,sku,detail){if(samples.length<15)samples.push(`${type}: ${sku}${detail?' ('+detail+')':''}`)}
for(let start=0;start<rows.length;start+=50){
 const batch=rows.slice(start,start+50);
 const nodes=await graphql(batch.map(x=>x.shopify_variant_id));
 for(let i=0;i<batch.length;i++){
  const seat=batch[i],variant=nodes[i];
  if(!variant||variant.id!==seat.shopify_variant_id){missing++;issue('Missing variant',seat.sku);continue}
  if(variant.sku!==seat.sku){skuMismatch++;issue('SKU mismatch',seat.sku,variant.sku)}
  if(cents(variant.price)!==seat.price_cents){priceMismatch++;issue('Price mismatch',seat.sku,`Shopify ${variant.price} vs D1 ${(seat.price_cents/100).toFixed(2)}`)}
  if(variant.product?.status!=='ACTIVE'){nonActive++;issue('Product not ACTIVE',seat.sku,variant.product?.status||'missing')}
 }
 if((start+batch.length)%500<50)console.log(`Checked ${start+batch.length}/${rows.length} Shopify variants`);
}
console.log(JSON.stringify({checked:rows.length,missing,skuMismatch,priceMismatch,nonActive,samples},null,2));
check(!missing&&!skuMismatch&&!priceMismatch,'FAIL: Shopify inventory does not match production D1; do not launch');
if(nonActive)console.log(`NOTICE: ${nonActive} Shopify variants belong to non-ACTIVE products; verify intentional launch publishing`);
console.log('PASS: Shopify product variants exist and every SKU and price matches production D1');
console.log('NOT VERIFIED: storefront publication, payment gateway, taxes, checkout accessibility, webhook subscription, or Worker secrets');
console.log('SAFE: No inventory was released and no Shopify or Cloudflare writes were performed');
