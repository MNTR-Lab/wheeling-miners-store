/** V73: offline read-only Shopify product-option preflight. Never performs writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const sectionSku=/^WM-ST-SEC-(\d{3})$/;
export function auditOptions(exported,{expectedSections=63}={}){
 const root=exported?.data?.products??exported?.products??exported;
 if(root?.pageInfo?.hasNextPage)throw Error('Incomplete product pagination');
 const nodes=Array.isArray(root)?root:root?.nodes??root?.edges?.map(e=>e.node);
 if(!Array.isArray(nodes))throw Error('Missing product array');
 const seen=new Set(),sections=[],issues=[];
 for(const p of nodes){
  if(p?.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variant pagination');
  const variants=p?.variants?.nodes??p?.variants?.edges?.map(e=>e.node);
  if(!Array.isArray(variants))throw Error('Missing variants');
  const markers=variants.filter(v=>sectionSku.test(v?.sku??''));
  if(!markers.length)continue;
  if(markers.length!==1){issues.push(`Multiple section markers in ${p.id}`);continue;}
  const section=sectionSku.exec(markers[0].sku)[1];
  if(seen.has(section)){issues.push(`Duplicate section ${section}`);continue;}seen.add(section);
  const optionNames=(p.options??[]).map(o=>o.name);
  const problems=[];
  if(p.status!=='DRAFT')problems.push('NOT_DRAFT');
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(p.id??''))problems.push('INVALID_PRODUCT_ID');
  if(markers[0].inventoryQuantity!==0)problems.push('PLACEHOLDER_HAS_INVENTORY');
  if(variants.length!==1)problems.push('NOT_PLACEHOLDER_ONLY');
  if(optionNames.length!==2||optionNames[0]!=='Row'||optionNames[1]!=='Seat')problems.push('ROW_SEAT_OPTIONS_MISSING');
  sections.push({section,product_id:p.id,placeholder_sku:markers[0].sku,options:optionNames,variant_count:variants.length,issues:problems});
 }
 if(seen.size!==expectedSections)issues.push(`Expected ${expectedSections} sections; found ${seen.size}`);
 sections.sort((a,b)=>a.section.localeCompare(b.section));
 return {mode:'READ_ONLY',sales_enabled:false,shopify_writes:0,sections_found:seen.size,ready_for_variant_creation:issues.length===0&&sections.every(s=>s.issues.length===0),global_issues:issues,sections};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw Error('Usage: node tools/audit-season-product-options.mjs shopify-export.json audit.json');const result=auditOptions(JSON.parse(readFileSync(process.argv[2],'utf8')));writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({sections:result.sections_found,ready:result.ready_for_variant_creation,issues:result.global_issues}));if(!result.ready_for_variant_creation)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=2;}
}
