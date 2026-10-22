/** V76: Resolve only unambiguous DRAFT section products from a complete Shopify export.
 * Never writes to Shopify or D1. Archived duplicates are recorded, not selected.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const MARKER=/^WM-ST-SEC-(\d{3})$/;
const GID=/^gid:\/\/shopify\/Product\/\d+$/;
export function resolveSections(payload,{expected=63}={}){
 const root=payload?.data?.products??payload?.products??payload;
 if(root?.pageInfo?.hasNextPage)throw Error('Product export incomplete: additional pages exist');
 const nodes=Array.isArray(root)?root:root?.nodes??root?.edges?.map(e=>e.node);
 if(!Array.isArray(nodes))throw Error('Invalid product export');
 const groups=new Map(),errors=[],ignored=[];
 for(const p of nodes){
  if(p?.variants?.pageInfo?.hasNextPage)throw Error('Variant export incomplete for '+p?.id);
  const vs=p?.variants?.nodes??p?.variants?.edges?.map(e=>e.node);
  if(!Array.isArray(vs))throw Error('Missing variants for '+p?.id);
  const markers=vs.filter(v=>MARKER.test(v?.sku??''));
  if(!markers.length)continue;
  if(markers.length!==1){errors.push('Multiple section markers in '+p.id);continue;}
  const section=MARKER.exec(markers[0].sku)[1];
  if(!groups.has(section))groups.set(section,[]);
  groups.get(section).push({product:p,variant:markers[0],variants:vs});
 }
 const sections=[];
 for(const [section,entries] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const drafts=entries.filter(e=>e.product.status==='DRAFT');
  const archived=entries.filter(e=>e.product.status==='ARCHIVED');
  for(const a of archived)ignored.push({section,product_id:a.product.id,status:'ARCHIVED'});
  if(entries.length!==drafts.length+archived.length)errors.push('Unexpected product status in '+section);
  if(drafts.length!==1){errors.push(`Section ${section}: expected one DRAFT product, found ${drafts.length}`);continue;}
  const {product:p,variant:v,variants:vs}=drafts[0];
  const problems=[];
  if(!GID.test(p.id))problems.push('INVALID_PRODUCT_ID');
  if(p.title!==`Wheeling Miners | Season Tickets | Section ${section}`)problems.push('TITLE_MISMATCH');
  if(vs.length!==1)problems.push('NON_PLACEHOLDER_VARIANTS');
  if(v.inventoryQuantity!==0)problems.push('NONZERO_INVENTORY');
  if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id??''))problems.push('INVALID_VARIANT_ID');
  const options=(p.options??[]).map(x=>x.name);
  if(!(options.length===1&&options[0]==='Title')&&!(options.length===2&&options[0]==='Row'&&options[1]==='Seat'))problems.push('UNEXPECTED_OPTIONS');
  if(problems.length)errors.push(`Section ${section}: ${problems.join(', ')}`);
  sections.push({section,product_id:p.id,placeholder_variant_id:v.id,placeholder_sku:v.sku,price:v.price,options,action:options.length===1?'CONVERT_OPTIONS':'OPTIONS_READY',problems});
 }
 if(sections.length!==expected)errors.push(`Expected ${expected} eligible sections, found ${sections.length}`);
 const ids=sections.map(s=>s.product_id);if(new Set(ids).size!==ids.length)errors.push('Product ID used by multiple sections');
 return {version:'V76',mode:'READ_ONLY',sales_enabled:false,shopify_writes:0,d1_writes:0,ready:errors.length===0,sections_found:sections.length,conversion_needed:sections.filter(x=>x.action==='CONVERT_OPTIONS').length,already_ready:sections.filter(x=>x.action==='OPTIONS_READY').length,ignored_archived:ignored,errors,sections};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==4)throw Error('Usage: node tools/resolve-season-section-products.mjs full-shopify-export.json output.json');const result=resolveSections(JSON.parse(readFileSync(process.argv[2],'utf8')));writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({ready:result.ready,sections:result.sections_found,ignored_archived:result.ignored_archived.length,errors:result.errors}));if(!result.ready)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=2;}}
