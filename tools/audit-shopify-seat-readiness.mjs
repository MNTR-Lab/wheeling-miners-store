/** V52: Read-only Shopify section/seat-variant audit against independent D1 seat export.
 * Never calls Shopify/D1 or authorizes sale. Shopify input is a complete GraphQL
 * products export (nodes or edges), with variants and product options included.
 * Usage: node tools/audit-shopify-seat-readiness.mjs seats.csv shopify-products.json [report.json]
 * No approved manifest is inferred or created from these records.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
const SEAT=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const SECTION=/^WM-ST-SEC-(\d{3})$/;
const productId=/^gid:\/\/shopify\/Product\/\d+$/;
const variantId=/^gid:\/\/shopify\/ProductVariant\/\d+$/;
const arr=x=>Array.isArray(x)?x:Array.isArray(x?.nodes)?x.nodes:Array.isArray(x?.edges)?x.edges.map(y=>y.node):null;
const issue=(issues,code,detail)=>issues.push({code,detail});
export function auditShopifyReadiness(seats,payload,{requireComplete=true}={}){
 const issues=[];
 if(!Array.isArray(seats)||!seats.length)throw Error('Missing D1 seats');
 for(const col of ['sku','section','row_label','seat_number','price_cents','status','shopify_variant_id'])if(!(col in seats[0]))throw Error('D1 export missing '+col);
 const root=payload?.data?.products??payload?.products??payload;
 const products=arr(root);
 if(!products)throw Error('Expected Shopify products nodes/edges');
 if(root?.pageInfo?.hasNextPage)throw Error('Shopify product export has more pages');
 const seatBySku=new Map(),seatsBySection=new Map(),productsBySection=new Map(),variantSkuSeen=new Set(),variantIdSeen=new Set();
 for(const s of seats){
  if(seatBySku.has(s.sku))issue(issues,'DUPLICATE_D1_SEAT',s.sku);
  seatBySku.set(s.sku,s);
  const m=SEAT.exec(s.sku||'');
  if(!m||m[1]!==s.section||m[2]!==s.row_label||Number(m[3])!==Number(s.seat_number))issue(issues,'INVALID_D1_SEAT',s.sku);
  if(s.status!=='UNRELEASED')issue(issues,'SEAT_RELEASED',s.sku);
  if(s.shopify_variant_id?.trim())issue(issues,'D1_ALREADY_MAPPED',s.sku);
  if(!seatsBySection.has(s.section))seatsBySection.set(s.section,[]);
  seatsBySection.get(s.section).push(s);
 }
 for(const p of products){
  if(!p||typeof p!=='object')throw Error('Invalid Shopify product');
  const variants=arr(p.variants);
  if(!variants||p.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variants for product '+p.id);
  const placeholders=variants.filter(v=>SECTION.test(v?.sku||''));
  const individual=variants.filter(v=>SEAT.test(v?.sku||''));
  if(!placeholders.length&&!individual.length)continue;
  const sections=new Set([...placeholders.map(v=>SECTION.exec(v.sku)[1]),...individual.map(v=>SEAT.exec(v.sku)[1])]);
  if(sections.size!==1){issue(issues,'MIXED_SECTION_PRODUCT',String(p.id));continue;}
  const section=[...sections][0];
  if(productsBySection.has(section)){issue(issues,'DUPLICATE_SECTION_PRODUCT',section);continue;}
  productsBySection.set(section,p);
  if(!productId.test(p.id||''))issue(issues,'INVALID_PRODUCT_ID',section);
  if(p.status!=='DRAFT')issue(issues,'PRODUCT_NOT_DRAFT',section);
  if(placeholders.length>1)issue(issues,'MULTIPLE_PLACEHOLDERS',section);
  if(variants.length>2048)issue(issues,'VARIANT_LIMIT_EXCEEDED',section);
  if(variants.length+seatsBySection.get(section)?.length>2048 && !individual.length)issue(issues,'PLANNED_VARIANT_LIMIT_EXCEEDED',section);
  if(individual.length){
   const options=arr(p.options)||[];
   const names=new Set(options.map(o=>o.name));
   if(!names.has('Row')||!names.has('Seat'))issue(issues,'MISSING_ROW_SEAT_OPTIONS',section);
  }
  for(const v of individual){
   if(variantSkuSeen.has(v.sku))issue(issues,'DUPLICATE_VARIANT_SKU',v.sku);
   variantSkuSeen.add(v.sku);
   if(!variantId.test(v.id||'')||variantIdSeen.has(v.id))issue(issues,'INVALID_OR_DUPLICATE_VARIANT_ID',v.sku);
   variantIdSeen.add(v.id);
   const s=seatBySku.get(v.sku);
   if(!s){issue(issues,'SHOPIFY_SEAT_NOT_IN_D1',v.sku);continue;}
   if(s.section!==section)issue(issues,'WRONG_SECTION_PRODUCT',v.sku);
   if(!/^\d+(?:\.\d{1,2})?$/.test(String(v.price))||Math.round(Number(v.price)*100)!==Number(s.price_cents))issue(issues,'PRICE_MISMATCH',v.sku);
   const quantity=v.inventoryQuantity??v.inventory_quantity;
   if(quantity===undefined||quantity===null)issue(issues,'INVENTORY_NOT_EXPORTED',v.sku);
   else if(Number(quantity)!==0)issue(issues,'NONZERO_SHOPIFY_INVENTORY',v.sku);
   if(v.inventoryPolicy!==undefined&&v.inventoryPolicy!=='DENY')issue(issues,'INVENTORY_POLICY_NOT_DENY',v.sku);
  }
 }
 for(const [section,ss] of seatsBySection){
  const p=productsBySection.get(section);
  if(!p){issue(issues,'MISSING_SECTION_PRODUCT',section);continue;}
  const variants=arr(p.variants);
  const present=new Set(variants.filter(v=>SEAT.test(v?.sku||'')).map(v=>v.sku));
  for(const s of ss)if(!present.has(s.sku))issue(issues,'MISSING_SHOPIFY_SEAT_VARIANT',s.sku);
 }
 for(const section of productsBySection.keys())if(!seatsBySection.has(section))issue(issues,'SHOPIFY_SECTION_NOT_IN_D1',section);
 if(requireComplete){if(seats.length!==3737)issue(issues,'D1_COUNT_NOT_3737',String(seats.length));if(seatsBySection.size!==63)issue(issues,'D1_SECTION_COUNT_NOT_63',String(seatsBySection.size));if(productsBySection.size!==63)issue(issues,'SHOPIFY_SECTION_COUNT_NOT_63',String(productsBySection.size));}
 const counts={};for(const x of issues)counts[x.code]=(counts[x.code]||0)+1;
 return {version:'V52',mode:'READ_ONLY',sales_enabled:false,shopify_mutations:0,d1_mutations:0,manifest_approval_verified:false,ready_for_sales:false,seat_count:seats.length,section_count:seatsBySection.size,shopify_section_products:productsBySection.size,shopify_individual_variants:variantSkuSeen.size,issue_count:issues.length,issue_counts:counts,issues:issues.slice(0,150),issues_truncated:Math.max(0,issues.length-150),next_steps:['Obtain independently approved arena/team seat manifest','Resolve all Shopify/D1 discrepancies','Verify seat mappings separately','Complete hold/checkout/payment fulfillment before any sale']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length<4||process.argv.length>5)throw Error('Usage: node tools/audit-shopify-seat-readiness.mjs seats.csv shopify-products.json [report.json]');
  const result=auditShopifyReadiness(parseCSV(readFileSync(process.argv[2],'utf8')),JSON.parse(readFileSync(process.argv[3],'utf8')));
  const body=JSON.stringify(result,null,2)+'\n';
  if(process.argv[4])writeFileSync(process.argv[4],body,{flag:'wx'});else process.stdout.write(body);
  process.exitCode=result.issue_count?1:0;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
