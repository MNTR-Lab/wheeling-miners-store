/** V77: guarded Shopify season-ticket operations. Default is dry-run.
 * NO publication, stock adjustment, D1 writes, or checkout activation.
 * Requires explicit independent approvals before any execution.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const ID=/^gid:\/\/shopify\/Product\/\d+$/;
const SKU=/^WM-ST-SEC-(\d{3})$/;
const INSPECT=`query($id:ID!){product(id:$id){id title status options{id name values} variants(first:10){pageInfo{hasNextPage} nodes{id sku inventoryQuantity inventoryPolicy}}}}`;
const RENAME=`mutation($id:ID!,$option:OptionUpdateInput!){productOptionUpdate(productId:$id,option:$option,variantStrategy:LEAVE_AS_IS){product{id} userErrors{field message}}}`;
const ADD=`mutation($id:ID!,$options:[OptionCreateInput!]!){productOptionsCreate(productId:$id,options:$options,variantStrategy:LEAVE_AS_IS){product{id} userErrors{field message}}}`;
const CREATE=`mutation($id:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$id,variants:$variants){productVariants{id sku price} userErrors{field message}}}`;
export function validateProduct(p,section,{allowCreated=false}={}){
 if(!p||!ID.test(p.id)||p.title!==`Wheeling Miners | Season Tickets | Section ${section}`||p.status!=='DRAFT')throw Error(`Unsafe section product ${section}`);
 const v=p.variants;if(!v||v.pageInfo?.hasNextPage!==false||!Array.isArray(v.nodes)||!v.nodes.length)throw Error('Incomplete variants');
 const placeholders=v.nodes.filter(x=>x.sku===`WM-ST-SEC-${section}`);
 if(placeholders.length!==1||placeholders[0].inventoryQuantity!==0)throw Error('Missing/stocked placeholder');
 if(!allowCreated&&v.nodes.length!==1)throw Error('Unexpected variants');
 if(allowCreated&&v.nodes.some(x=>x.inventoryQuantity!==0))throw Error('Nonzero Shopify inventory');
 const options=p.options?.map(x=>x.name)||[];
 if(!(['Title','Row,Seat','Row'].includes(options.join(','))))throw Error('Unexpected option layout');
 if(options.length===1&&options[0]==='Title'&&(p.options[0].values.length!==1||p.options[0].values[0]!==`Section ${section}`))throw Error('Unexpected placeholder value');
 return options.join(',');
}
export function chooseSections(exported){
 const root=exported?.data?.products??exported?.products??exported;
 if(root?.pageInfo?.hasNextPage)throw Error('Incomplete product export');
 const nodes=Array.isArray(root)?root:root?.nodes??root?.edges?.map(x=>x.node);
 if(!Array.isArray(nodes))throw Error('Missing products');
 const groups=new Map();
 for(const p of nodes){
  if(p.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variants');
  for(const v of p.variants?.nodes??[]){const m=SKU.exec(v.sku||'');if(!m)continue;
   if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1]).push(p);
  }
 }
 const result=[];
 for(const [section,entries] of groups){
  const drafts=entries.filter(p=>p.status==='DRAFT');
  if(drafts.length!==1||entries.some(p=>!['DRAFT','ARCHIVED'].includes(p.status)))throw Error(`Ambiguous section ${section}`);
  result.push({section,id:drafts[0].id});
 }
 if(result.length!==63)throw Error(`Expected 63 sections; found ${result.length}`);
 return result.sort((a,b)=>a.section.localeCompare(b.section));
}
export function makeShopify({domain,token,fetchImpl=fetch}){
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain||'')||!token)throw Error('Invalid Shopify credentials');
 const url=`https://${domain}/admin/api/2026-10/graphql.json`;
 return async (query,variables)=>{
  const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query,variables})});
  if(!response.ok)throw Error(`Shopify HTTP ${response.status}`);
  const body=await response.json();if(body.errors?.length)throw Error(`Shopify GraphQL: ${body.errors.map(x=>x.message).join('; ')}`);
  if(!body.data)throw Error('Shopify response missing data');return body.data;
 };
}
export async function convertSection({section,id,graphql,execute=false}){
 const before=(await graphql(INSPECT,{id})).product;
 if(before?.id!==id)throw Error('Shopify product ID mismatch');
 let state=validateProduct(before,section);
 const changes=[];
 if(state==='Row,Seat')return {section,id,result:'ALREADY_CONFIGURED',changes};
 if(!execute)return {section,id,result:'DRY_RUN',changes:state==='Title'?['RENAME_TITLE_TO_ROW','ADD_SEAT_OPTION']:['ADD_SEAT_OPTION']};
 if(state==='Title'){
  const r=await graphql(RENAME,{id,option:{id:before.options[0].id,name:'Row'}});
  if(r.productOptionUpdate?.userErrors?.length||r.productOptionUpdate?.product?.id!==id)throw Error('Rename failed: '+JSON.stringify(r.productOptionUpdate?.userErrors));
  changes.push('RENAME_TITLE_TO_ROW');
  const after=(await graphql(INSPECT,{id})).product;state=validateProduct(after,section);
  if(state!=='Row'||after.variants.nodes[0].id!==before.variants.nodes[0].id)throw Error('Rename postcondition failed');
 }
 if(state==='Row'){
  const r=await graphql(ADD,{id,options:[{name:'Seat',values:[{name:'PENDING'}]}]});
  if(r.productOptionsCreate?.userErrors?.length||r.productOptionsCreate?.product?.id!==id)throw Error('Add Seat failed: '+JSON.stringify(r.productOptionsCreate?.userErrors));
  changes.push('ADD_SEAT_OPTION');
 }
 const after=(await graphql(INSPECT,{id})).product;
 if(validateProduct(after,section)!=='Row,Seat'||after.variants.nodes[0].id!==before.variants.nodes[0].id)throw Error('Final postcondition failed');
 return {section,id,result:'CONVERTED',changes,placeholder_sku:after.variants.nodes[0].sku,inventory:0,sales_enabled:false};
}
export function validateVariantBatch(batch){
 if(!/^\d{3}$/.test(batch?.section||'')||!ID.test(batch?.request?.variables?.productId))throw Error('Invalid batch');
 const vs=batch.request.variables.variants;
 if(!Array.isArray(vs)||!vs.length||vs.length>50||vs.some(v=>!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(v.inventoryItem?.sku||'')||v.inventoryPolicy!=='DENY'||v.inventoryItem?.tracked!==true||!/^\d+\.\d{2}$/.test(v.price)||Number(v.price)<=0||v.optionValues?.[0]?.optionName!=='Row'||v.optionValues?.[1]?.optionName!=='Seat'))throw Error('Unsafe variants');
 if(vs.some(v=>v.inventoryItem.sku.slice(6,9)!==batch.section))throw Error('Section mismatch');
 if(new Set(vs.map(v=>v.inventoryItem.sku)).size!==vs.length)throw Error('Duplicate SKU');
 return vs;
}
export async function createVariantBatch({batch,graphql,execute=false}){
 const vs=validateVariantBatch(batch),id=batch.request.variables.productId,section=batch.section;
 const before=(await graphql(INSPECT,{id})).product;
 if(validateProduct(before,section,{allowCreated:true})!=='Row,Seat')throw Error('Row and Seat options not ready');
 const existing=new Set(before.variants.nodes.map(v=>v.sku));
 if(vs.some(v=>existing.has(v.inventoryItem.sku)))throw Error('Already created SKU; stop for reconciliation');
 if(!execute)return {section,result:'DRY_RUN',count:vs.length};
 const r=await graphql(CREATE,{id,variants:vs});
 const data=r.productVariantsBulkCreate;
 if(data?.userErrors?.length||!Array.isArray(data?.productVariants)||data.productVariants.length!==vs.length)throw Error('Bulk creation incomplete: '+JSON.stringify(data?.userErrors));
 const returned=new Set(data.productVariants.map(v=>v.sku));
 if(vs.some(v=>!returned.has(v.inventoryItem.sku)))throw Error('Returned SKUs mismatch');
 return {section,result:'CREATED_NEEDS_INVENTORY_RECHECK',count:vs.length,variants:data.productVariants};
}
async function main(){
 const [mode,file,section,flag]=process.argv.slice(2);
 if(!['options','variants'].includes(mode)||!file||!/^\d{3}$/.test(section||'')||!['--dry-run','--execute'].includes(flag))throw Error('Usage: node tools/shopify-season-operations.mjs options|variants input.json SECTION --dry-run|--execute');
 const payload=JSON.parse(readFileSync(file,'utf8'));
 const execute=flag==='--execute';
 if(execute&&process.env.WM_SEASON_WRITE_CONFIRM!==`I_APPROVE_DRAFT_SECTION_${section}`)throw Error('Explicit section-scoped confirmation required');
 const graphql=makeShopify({domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_TOKEN});
 let output;
 if(mode==='options'){
  const entries=chooseSections(payload);const selected=entries.find(x=>x.section===section);
  if(!selected)throw Error('Section missing');
  output=await convertSection({...selected,graphql,execute});
 }else{
  if(execute&&process.env.WM_SEAT_MAP_PRICE_APPROVED!=='YES')throw Error('Independently approved map/prices required');
  if(payload?.mode!=='OFFLINE_MUTATION_PAYLOADS_ONLY'||payload.seat_count!==3737||payload.section_count!==63||payload.sales_enabled!==false)throw Error('Invalid independently approved V72 batch plan');
  const matches=payload.batches?.filter(x=>x.section===section);
  if(!matches?.length)throw Error('Missing section batches');
  // Exactly one batch per invocation to avoid ambiguous partial writes.
  if(matches.length!==1)throw Error('Multiple batches for section; use a per-batch input file and verified continuation workflow');
  output=await createVariantBatch({batch:matches[0],graphql,execute});
 }
 console.log(JSON.stringify(output,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
