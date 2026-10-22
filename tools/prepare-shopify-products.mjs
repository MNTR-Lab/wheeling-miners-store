/** V44: Read-only conversion of Shopify GraphQL product export into V42 section CSV.
 * No Shopify credentials, network requests, writes, or inventory release.
 * Usage: node tools/prepare-shopify-products.mjs shopify-products.json shopify-products.csv
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const HEADER='section,product_id,product_sku,product_status,variant_count';
const gid=/^gid:\/\/shopify\/Product\/\d+$/;
const sku=/^WM-ST-SEC-(\d{3})$/;
const esc=x=>'"'+String(x).replaceAll('"','""')+'"';
export function convertProducts(payload,{requireComplete=true}={}){
 const root=payload?.data?.products??payload?.products??payload;
 const nodes=Array.isArray(root)?root:Array.isArray(root?.nodes)?root.nodes:Array.isArray(root?.edges)?root.edges.map(x=>x.node):null;
 if(!nodes||!nodes.length)throw Error('Expected nonempty Shopify product nodes/edges');
 if(root?.pageInfo?.hasNextPage)throw Error('Shopify export is paginated; fetch all pages first');
 const output=[],seen=new Set();
 for(const p of nodes){
  if(!p||typeof p!=='object')throw Error('Invalid Shopify product');
  const variants=Array.isArray(p.variants?.nodes)?p.variants.nodes:Array.isArray(p.variants?.edges)?p.variants.edges.map(x=>x.node):Array.isArray(p.variants)?p.variants:null;
  if(!variants||!variants.length)throw Error('Missing complete variants for product '+p.id);
  if(p.variants?.pageInfo?.hasNextPage)throw Error('Variants are paginated for '+p.id);
  const placeholders=variants.filter(v=>sku.test(v?.sku||''));
  if(!placeholders.length){if(variants.some(v=>/^WM-ST-/.test(v?.sku||'')))throw Error('Unexpected seat variant without section placeholder in '+p.id);continue;}
  if(placeholders.length!==1)throw Error('Expected exactly one section placeholder in '+p.id);
  const m=sku.exec(placeholders[0].sku),section=m[1];
  if(!gid.test(p.id))throw Error('Invalid Shopify product ID: '+p.id);
  if(seen.has(section))throw Error('Duplicate Shopify section '+section);seen.add(section);
  if(p.status!=='DRAFT')throw Error('Non-draft section product '+section);
  if(variants.some(v=>v!==placeholders[0]&&/^WM-ST-SEC-/.test(v.sku||'')))throw Error('Extra placeholder in '+section);
  output.push({section,product_id:p.id,product_sku:placeholders[0].sku,product_status:p.status,variant_count:variants.length});
 }
 if(requireComplete&&output.length!==63)throw Error('Incomplete Shopify section export: '+output.length+' of 63');
 output.sort((a,b)=>a.section.localeCompare(b.section));
 return {csv:HEADER+'\n'+output.map(p=>Object.values(p).map(esc).join(',')).join('\n')+'\n',summary:{section_products:output.length,shopify_mutations:0,sales_enabled:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw Error('Usage: node tools/prepare-shopify-products.mjs input.json output.csv');const out=convertProducts(JSON.parse(readFileSync(process.argv[2],'utf8')));writeFileSync(process.argv[3],out.csv,{flag:'wx'});console.log(JSON.stringify(out.summary));}catch(e){console.error(e.message);process.exitCode=1;}
}
