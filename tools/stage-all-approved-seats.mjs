/** Draft-only Shopify seat staging. No publishing, inventory release, checkout, or D1 writes. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
import {makeShopify,stageOptions,stageBatch} from './shopify-season-safe-runner.mjs';

const mode=process.argv[2]??'dry-run';
if(!['dry-run','execute'].includes(mode))throw Error('Usage: node tools/stage-all-approved-seats.mjs dry-run|execute');
const execute=mode==='execute';
if(execute&&process.env.WM_BULK_DRAFT_CONFIRM!=='CREATE_3700_DRAFT_SEATS_ONLY')throw Error('Explicit bulk staging confirmation missing');
if(execute&&process.env.WM_SEAT_MAP_PRICE_APPROVED!=='YES')throw Error('Seat map/price approval missing');
const products=parseCSV(readFileSync('data/staging/shopify-products.csv','utf8'));
const plan=JSON.parse(readFileSync('data/staging/shopify-variant-batches.json','utf8'));
if(products.length!==63||new Set(products.map(p=>p.section)).size!==63)throw Error('Expected 63 distinct section products');
if(plan.mode!=='OFFLINE_MUTATION_PAYLOADS_ONLY'||plan.executed!==false||plan.sales_enabled!==false||plan.seat_count!==3737||plan.section_count!==63||plan.batch_count!==105||plan.batches?.length!==105)throw Error('Unexpected approved batch plan');
const ids=new Map();for(const p of products){if(!/^\d{3}$/.test(p.section)||p.product_status!=='DRAFT'||p.product_sku!==`WM-ST-SEC-${p.section}`||!/^gid:\/\/shopify\/Product\/\d+$/.test(p.product_id))throw Error('Invalid draft product');ids.set(p.section,p.product_id);}
const bySection=new Map();const allSkus=new Set();let count=0;
for(const batch of plan.batches){const id=ids.get(batch.section);if(!id||batch.request?.variables?.productId!==id||!Number.isInteger(batch.part)||batch.part<1)throw Error('Wrong product/batch mapping');const skus=batch.request.variables.variants.map(v=>v.inventoryItem?.sku);if(skus.length<1||skus.length>50||skus.some(s=>!s||allSkus.has(s)))throw Error('Duplicate or invalid SKU');for(const s of skus)allSkus.add(s);count+=skus.length;if(!bySection.has(batch.section))bySection.set(batch.section,[]);bySection.get(batch.section).push(batch);}
if(count!==3737||bySection.size!==63)throw Error('Seat total mismatch');
for(const [section,batches] of bySection){batches.sort((a,b)=>a.part-b.part);if(batches.some((b,i)=>b.part!==i+1))throw Error('Noncontiguous parts in section '+section);}
const graphql=makeShopify({domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_TOKEN});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={mode,started_at:new Date().toISOString(),expected_total:3737,sections:[],newly_created:0,already_created:0,remaining_to_create:0,variant_mapping:[],status:'IN_PROGRESS'};
mkdirSync('staging-output',{recursive:true});
function save(){writeFileSync('staging-output/staging-report.json',JSON.stringify(report,null,2));writeFileSync('staging-output/verified-variant-mapping.json',JSON.stringify({source:'SHOPIFY_VERIFIED_STAGING',generated_at:new Date().toISOString(),variants:report.variant_mapping},null,2));}
try{
 for(const section of [...bySection.keys()].sort()){
  const id=ids.get(section);const result={section,product_id:id,options:null,batches:[]};report.sections.push(result);
  const option=await stageOptions({graphql,id,section,execute});result.options={action:option.action,state:option.state??null};
  console.log(`Section ${section}: options ${option.action}`);
  if(!execute&&option.state!=='Row,Seat'){
   result.note='Options must be configured before variant dry-run; no writes performed';
   for(const batch of bySection.get(section))report.remaining_to_create+=batch.request.variables.variants.length;
   save();continue;
  }
  for(const batch of bySection.get(section)){
   const outcome=await stageBatch({graphql,id,section,batch,execute});
   result.batches.push({part:batch.part,result:outcome.result,count:outcome.count??outcome.would_create??0});
   if(outcome.result==='CREATED_AND_VERIFIED'){report.newly_created+=outcome.count;report.variant_mapping.push(...outcome.variants);}
   if(outcome.result==='ALREADY_CREATED')report.already_created+=outcome.count;
   if(outcome.result==='DRY_RUN')report.remaining_to_create+=outcome.would_create;
   console.log(`Section ${section}, batch ${batch.part}: ${outcome.result}, count ${outcome.count??outcome.would_create??0}`);
   save();await sleep(350);
  }
 }
 report.status='COMPLETE';report.finished_at=new Date().toISOString();save();
 console.log(JSON.stringify({status:report.status,mode,newly_created:report.newly_created,already_created:report.already_created,remaining_to_create:report.remaining_to_create,sections:report.sections.length}));
}catch(err){report.status='STOPPED_ON_ERROR';report.error=String(err?.message??err);report.finished_at=new Date().toISOString();save();console.error('STOPPED ON ERROR: '+report.error);process.exitCode=1;}
