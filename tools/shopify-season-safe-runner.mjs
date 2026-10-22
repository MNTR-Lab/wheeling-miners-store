/** V78 guarded, resumable Shopify option + seat variant staging. Sales never enabled. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function makeShopify({domain,token,fetchImpl=fetch}){
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain||'')||!token)throw Error('Missing Shopify credentials');
 return async(query,variables)=>{const r=await fetchImpl(`https://${domain}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query,variables})});if(!r.ok)throw Error('Shopify HTTP '+r.status);const data=await r.json();if(data.errors?.length||!data.data)throw Error('Shopify GraphQL failed: '+JSON.stringify(data.errors));return data.data;};
}
export function chooseSections(payload){
 const root=payload?.data?.products??payload?.products??payload;
 if(root?.pageInfo?.hasNextPage)throw Error('Incomplete product export');
 const products=Array.isArray(root)?root:root?.nodes??root?.edges?.map(x=>x.node);
 if(!Array.isArray(products))throw Error('Missing product export');
 const groups=new Map();for(const p of products){if(p.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variant export');for(const v of p.variants?.nodes??[]){const m=/^WM-ST-SEC-(\d{3})$/.exec(v.sku||'');if(!m)continue;if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1]).push(p);}}
 const sections=[];for(const [section,items] of groups){const drafts=items.filter(x=>x.status==='DRAFT');if(drafts.length!==1||items.some(x=>!['DRAFT','ARCHIVED'].includes(x.status)))throw Error('Ambiguous section '+section);sections.push({section,id:drafts[0].id});}
 if(sections.length!==63)throw Error('Expected 63 sections, found '+sections.length);return sections.sort((a,b)=>a.section.localeCompare(b.section));
}
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const QUERY=`query($id:ID!,$after:String){product(id:$id){id title status options{id name values} variants(first:250,after:$after){pageInfo{hasNextPage endCursor}nodes{id sku inventoryQuantity inventoryPolicy price}}}}`;
const RENAME=`mutation($id:ID!,$option:OptionUpdateInput!){productOptionUpdate(productId:$id,option:$option,variantStrategy:LEAVE_AS_IS){product{id} userErrors{field message}}}`;
const ADD=`mutation($id:ID!,$options:[OptionCreateInput!]!){productOptionsCreate(productId:$id,options:$options,variantStrategy:LEAVE_AS_IS){product{id} userErrors{field message}}}`;
const CREATE=`mutation($id:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$id,variants:$variants){productVariants{id sku price} userErrors{field message}}}`;
export async function inspect(graphql,id){
 let after=null,all=[],product,seen=new Set();
 do{
  const p=(await graphql(QUERY,{id,after})).product;
  if(!p||p.id!==id||!p.variants?.pageInfo||!Array.isArray(p.variants.nodes))throw Error('Incomplete Shopify inspection');
  if(product&&(p.title!==product.title||p.status!==product.status||JSON.stringify(p.options)!==JSON.stringify(product.options)))throw Error('Product changed during pagination');
  product=p;
  for(const v of p.variants.nodes){if(seen.has(v.id))throw Error('Repeated Shopify variant');seen.add(v.id);all.push(v);}
  if(!p.variants.pageInfo.hasNextPage)break;
  const cursor=p.variants.pageInfo.endCursor;
  if(!cursor||cursor===after)throw Error('Repeated or missing cursor');after=cursor;
  if(all.length>2048)throw Error('Variant limit exceeded');
 }while(true);
 return {...product,variants:all};
}
export function assertDraft(p,section){
 if(p?.title!==`Wheeling Miners | Season Tickets | Section ${section}`||p.status!=='DRAFT')throw Error('Wrong or non-draft product');
 const marker=p.variants.filter(v=>v.sku===`WM-ST-SEC-${section}`);
 if(marker.length!==1||marker[0].inventoryQuantity!==0||p.variants.some(v=>v.inventoryQuantity!==0))throw Error('Missing placeholder or nonzero inventory');
 if(p.variants.length>2048)throw Error('Variant cap exceeded');
 const options=p.options.map(x=>x.name).join(',');
 if(!['Title','Row','Row,Seat'].includes(options))throw Error('Unexpected option structure');
 if(options==='Title'&&(p.options[0].values.length!==1||p.options[0].values[0]!==`Section ${section}`))throw Error('Unexpected title value');
 return options;
}
function checkMutation(result,key,id){const x=result?.[key];if(!x||x.userErrors?.length||x.product?.id!==id)throw Error(`${key} rejected: ${JSON.stringify(x?.userErrors)}`);}
export async function stageOptions({graphql,id,section,execute=false}){
 let p=await inspect(graphql,id),state=assertDraft(p,section),original=p.variants.find(x=>x.sku===`WM-ST-SEC-${section}`).id;
 if(!execute)return {section,action:state==='Row,Seat'?'READY':'NEEDS_OPTIONS',state,writes:0};
 if(state==='Title'){
  checkMutation(await graphql(RENAME,{id,option:{id:p.options[0].id,name:'Row'}}),'productOptionUpdate',id);
  p=await inspect(graphql,id);state=assertDraft(p,section);
  if(state!=='Row'||p.variants.find(x=>x.sku===`WM-ST-SEC-${section}`).id!==original)throw Error('Rename postcondition failed');
 }
 if(state==='Row'){
  checkMutation(await graphql(ADD,{id,options:[{name:'Seat',values:[{name:'PENDING'}]}]}),'productOptionsCreate',id);
  p=await inspect(graphql,id);state=assertDraft(p,section);
 }
 if(state!=='Row,Seat'||p.variants.find(x=>x.sku===`WM-ST-SEC-${section}`).id!==original)throw Error('Option conversion postcondition failed');
 return {section,action:'OPTIONS_READY',state,variant_count:p.variants.length,sales_enabled:false};
}
export function validateBatch(batch,section,id){
 if(batch?.section!==section||batch.request?.variables?.productId!==id)throw Error('Wrong section/product batch');
 const vs=batch.request.variables.variants;
 if(!Array.isArray(vs)||!vs.length||vs.length>50)throw Error('Invalid batch size');
 const seen=new Set();
 for(const v of vs){const sku=v.inventoryItem?.sku,m=SKU.exec(sku||'');if(!m||m[1]!==section||seen.has(sku)||v.inventoryPolicy!=='DENY'||v.inventoryItem.tracked!==true||!/^\d+\.\d{2}$/.test(v.price)||Number(v.price)<=0||v.optionValues?.length!==2||v.optionValues[0].optionName!=='Row'||v.optionValues[0].name!==m[2]||v.optionValues[1].optionName!=='Seat'||Number(v.optionValues[1].name)!==Number(m[3]))throw Error('Unsafe or duplicate seat variant');seen.add(sku);}
 return vs;
}
export async function stageBatch({graphql,id,section,batch,execute=false}){
 const vs=validateBatch(batch,section,id),p=await inspect(graphql,id);
 if(assertDraft(p,section)!=='Row,Seat')throw Error('Options not configured');
 const existing=new Map(p.variants.map(x=>[x.sku,x]));let already=0,missing=[];
 for(const v of vs){const prior=existing.get(v.inventoryItem.sku);if(prior){if(prior.price!==v.price||prior.inventoryPolicy!=='DENY'||prior.inventoryQuantity!==0)throw Error('Existing variant mismatch: '+v.inventoryItem.sku);already++;}else missing.push(v);}
 if(already&&missing.length)throw Error('Partially completed batch; reconcile before retry');
 if(already===vs.length)return {section,result:'ALREADY_CREATED',count:already,writes:0};
 if(p.variants.length+missing.length>2048)throw Error('Variant limit exceeded');
 if(!execute)return {section,result:'DRY_RUN',would_create:missing.length,writes:0};
 const data=(await graphql(CREATE,{id,variants:missing})).productVariantsBulkCreate;
 if(!data||data.userErrors?.length||data.productVariants?.length!==missing.length)throw Error('Shopify bulk response incomplete: '+JSON.stringify(data?.userErrors));
 const created=new Map(data.productVariants.map(x=>[x.sku,x]));
 for(const v of missing)if(!created.has(v.inventoryItem.sku)||created.get(v.inventoryItem.sku).price!==v.price)throw Error('Returned variant mismatch');
 const after=await inspect(graphql,id);assertDraft(after,section);
 for(const v of missing){const actual=after.variants.find(x=>x.sku===v.inventoryItem.sku);if(!actual||actual.price!==v.price||actual.inventoryPolicy!=='DENY'||actual.inventoryQuantity!==0)throw Error('Post-write Shopify variant mismatch: '+v.inventoryItem.sku);}
 return {section,result:'CREATED_AND_VERIFIED',count:missing.length,variants:missing.map(v=>({sku:v.inventoryItem.sku,id:after.variants.find(x=>x.sku===v.inventoryItem.sku).id})),sales_enabled:false};
}
async function main(){
 const [mode,input,section,part,flag]=process.argv.slice(2);
 if(!['options','variants'].includes(mode)||!input||!/^\d{3}$/.test(section||'')||!['--dry-run','--execute'].includes(flag)||!/^(\d+|-)$/ .test(part||''))throw Error('Usage: node tools/shopify-season-safe-runner.mjs options|variants input.json SECTION PART|\u002d --dry-run|--execute');
 const execute=flag==='--execute';
 if(execute&&process.env.WM_SEASON_WRITE_CONFIRM!==`I_APPROVE_DRAFT_SECTION_${section}`)throw Error('Section-scoped write confirmation required');
 const data=JSON.parse(readFileSync(input,'utf8'));
 const graphql=makeShopify({domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_TOKEN});
 let output;
 if(mode==='options'){
  const chosen=chooseSections(data).find(x=>x.section===section);if(!chosen)throw Error('Unknown section');
  output=await stageOptions({...chosen,graphql,execute});
 }else{
  if(execute&&process.env.WM_SEAT_MAP_PRICE_APPROVED!=='YES')throw Error('Independent seat map/price approval required');
  if(data.mode!=='OFFLINE_MUTATION_PAYLOADS_ONLY'||data.seat_count!==3737||data.section_count!==63||data.sales_enabled!==false)throw Error('Approved V72 batch plan required');
  const matches=data.batches.filter(b=>b.section===section&&b.part===Number(part));if(matches.length!==1)throw Error('Exactly one matching batch required');
  const id=matches[0].request.variables.productId;
  output=await stageBatch({graphql,id,section,batch:matches[0],execute});
 }
 console.log(JSON.stringify(output,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
