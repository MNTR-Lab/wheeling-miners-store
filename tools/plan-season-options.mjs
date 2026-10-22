/** V74: Offline, read-only section product option migration preflight.
 * Input: complete Shopify product export from fetch-shopify-seat-products.mjs.
 * Output: review-only report. Never calls Shopify or mutates inventory.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const SKU=/^WM-ST-SEC-(\d{3})$/;
export function planSeasonOptions(payload,{expectedSections=63}={}){
 const root=payload?.data?.products??payload?.products??payload;
 if(root?.pageInfo?.hasNextPage)throw Error('Incomplete product pagination');
 const products=Array.isArray(root)?root:root?.nodes??root?.edges?.map(e=>e.node);
 if(!Array.isArray(products))throw Error('Missing Shopify products');
 const sections=[],seen=new Set(),errors=[];
 for(const p of products){
  if(p?.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variant pagination');
  const variants=p?.variants?.nodes??p?.variants?.edges?.map(e=>e.node);
  if(!Array.isArray(variants))throw Error('Missing variants');
  const markers=variants.filter(v=>SKU.test(v?.sku??''));
  if(!markers.length)continue;
  if(markers.length!==1){errors.push(`Multiple placeholders: ${p.id}`);continue;}
  const section=SKU.exec(markers[0].sku)[1];
  if(seen.has(section)){errors.push(`Duplicate section ${section}`);continue;}
  seen.add(section);
  const options=(p.options??[]).map(o=>o.name);
  const issues=[];
  if(p.status!=='DRAFT')issues.push('NOT_DRAFT');
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(p.id??''))issues.push('INVALID_PRODUCT_ID');
  if(variants.length!==1)issues.push('HAS_NON_PLACEHOLDER_VARIANTS');
  if(Number(markers[0].inventoryQuantity)!==0)issues.push('PLACEHOLDER_INVENTORY_NOT_ZERO');
  if(options.length===1&&options[0]==='Title'){}else if(options.length===2&&options[0]==='Row'&&options[1]==='Seat'){}else issues.push('UNEXPECTED_PRODUCT_OPTIONS');
  sections.push({section,product_id:p.id,placeholder_variant_id:markers[0].id,placeholder_sku:markers[0].sku,current_options:options,action:issues.length?'BLOCKED':options[0]==='Title'?'REVIEW_OPTION_CONVERSION':'OPTIONS_ALREADY_READY',issues});
 }
 if(seen.size!==expectedSections)errors.push(`Expected ${expectedSections} sections, found ${seen.size}`);
 sections.sort((a,b)=>a.section.localeCompare(b.section));
 return {version:'V74',mode:'REVIEW_ONLY',shopify_writes:0,d1_writes:0,sales_enabled:false,sections_found:seen.size,option_conversion_needed:sections.filter(s=>s.action==='REVIEW_OPTION_CONVERSION').length,options_ready:sections.filter(s=>s.action==='OPTIONS_ALREADY_READY').length,blocked:sections.filter(s=>s.action==='BLOCKED').length,errors,sections,notes:['Do not convert product options without checking the Shopify productOptionsCreate/productOptionUpdate strategy and placeholder behavior.','The existing section placeholder must not become purchasable.','Re-query Shopify product after each approved option migration.','This report is not authorization to publish products or release seats.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==4)throw Error('Usage: node tools/plan-season-options.mjs shopify-export.json report.json');const result=planSeasonOptions(JSON.parse(readFileSync(process.argv[2],'utf8')));writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({sections:result.sections_found,needs_conversion:result.option_conversion_needed,blocked:result.blocked,errors:result.errors}));if(result.errors.length||result.blocked)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=2;}}
