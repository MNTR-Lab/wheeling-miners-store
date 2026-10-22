/** V56: read-only, paginated Shopify Admin GraphQL export for seat audits.
 * Requires SHOPIFY_ADMIN_TOKEN and SHOPIFY_SHOP_DOMAIN in the calling environment.
 * Does not mutate products, inventory, or tickets.
 */
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const PRODUCT_QUERY=`query SeatAuditProducts($after:String){products(first:50,after:$after,query:"sku:WM-ST-SEC-* OR sku:WM-ST-1* OR sku:WM-ST-2* OR sku:WM-ST-3*"){pageInfo{hasNextPage endCursor}nodes{id status options{name} variants(first:250){pageInfo{hasNextPage endCursor}nodes{id sku price inventoryQuantity inventoryPolicy}}}}}`;
const VARIANT_QUERY=`query SeatAuditVariants($id:ID!,$after:String){product(id:$id){id variants(first:250,after:$after){pageInfo{hasNextPage endCursor}nodes{id sku price inventoryQuantity inventoryPolicy}}}}`;
export function validateDomain(domain){if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain||''))throw Error('Expected a *.myshopify.com domain');return domain.toLowerCase();}
export async function exportSeatProducts({domain,token,fetchImpl=globalThis.fetch,apiVersion='2026-10'}={}){
 domain=validateDomain(domain);if(!token||typeof token!=='string')throw Error('Missing SHOPIFY_ADMIN_TOKEN');
 if(!/^20\d\d-(01|04|07|10)$/.test(apiVersion))throw Error('Invalid Shopify API version');
 const url=`https://${domain}/admin/api/${apiVersion}/graphql.json`;
 async function query(q,variables){const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query:q,variables})});if(!response.ok)throw Error('Shopify HTTP '+response.status);const payload=await response.json();if(payload.errors?.length)throw Error('Shopify GraphQL errors: '+payload.errors.map(e=>e.message).join('; '));if(!payload.data)throw Error('Missing Shopify GraphQL data');return payload.data;}
 const products=[],seenProducts=new Set(),seenPages=new Set();let after=null;
 do{
  const data=await query(PRODUCT_QUERY,{after});const connection=data.products;if(!connection?.nodes||!connection.pageInfo)throw Error('Malformed product page');
  for(const p of connection.nodes){if(seenProducts.has(p.id))throw Error('Duplicate Shopify product '+p.id);seenProducts.add(p.id);
   if(!p.variants?.nodes||!p.variants.pageInfo)throw Error('Malformed variant page for '+p.id);
   const variants=[...p.variants.nodes],seenVariants=new Set(variants.map(v=>v.id));let vAfter=p.variants.pageInfo.endCursor;
   while(p.variants.pageInfo.hasNextPage){if(!vAfter)throw Error('Missing variant cursor for '+p.id);const next=await query(VARIANT_QUERY,{id:p.id,after:vAfter});const conn=next.product?.variants;if(!conn?.nodes||!conn.pageInfo)throw Error('Malformed variant continuation for '+p.id);for(const v of conn.nodes){if(seenVariants.has(v.id))throw Error('Duplicate variant '+v.id);seenVariants.add(v.id);variants.push(v);}p.variants.pageInfo=conn.pageInfo;vAfter=conn.pageInfo.endCursor;}
   products.push({id:p.id,status:p.status,options:p.options,variants:{nodes:variants,pageInfo:{hasNextPage:false,endCursor:vAfter}}});
  }
  if(!connection.pageInfo.hasNextPage)break;
  after=connection.pageInfo.endCursor;if(!after||seenPages.has(after))throw Error('Missing/repeated product pagination cursor');seenPages.add(after);
 }while(true);
 return {data:{products:{nodes:products,pageInfo:{hasNextPage:false}}},meta:{mode:'READ_ONLY',sales_enabled:false,product_count:products.length,variant_count:products.reduce((n,p)=>n+p.variants.nodes.length,0)}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==3)throw Error('Usage: node tools/fetch-shopify-seat-products.mjs output.json');const data=await exportSeatProducts({domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_TOKEN});writeFileSync(process.argv[2],JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(data.meta));}catch(e){console.error(e.message);process.exitCode=1;}}
