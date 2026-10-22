/** V72: offline, fail-closed Shopify season-seat mutation payload builder.
 * Input: approved output from tools/plan-shopify-seat-variants.mjs.
 * Output: JSON request bodies ONLY. Does not connect to Shopify or Cloudflare.
 * Usage: node tools/build-season-variant-batches.mjs approved-plan.json output.json
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const MUTATION=`mutation CreateSeasonSeatVariants($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$productId,variants:$variants){productVariants{id sku price inventoryPolicy inventoryItem{tracked sku}} userErrors{field message}}}`;
const GID=/^gid:\/\/shopify\/Product\/\d+$/;
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
function assert(condition,message){if(!condition)throw Error(message);}
export function buildBatches(plan,{batchSize=50}={}){
 assert(Number.isSafeInteger(batchSize)&&batchSize>=1&&batchSize<=100,'Batch size must be 1–100');
 assert(plan&&plan.ready_to_generate_payloads===true&&plan.mode==='OFFLINE_PLAN_ONLY'&&plan.sales_enabled===false,'Independent approval planner must report ready, offline, sales disabled');
 assert(plan.seat_count===3737&&plan.section_count===63&&Array.isArray(plan.sections)&&plan.sections.length===63,'Expected exactly 3,737 seats in 63 sections');
 const skus=new Set(),products=new Set(),batches=[];let total=0;
 for(const group of plan.sections){
  assert(/^\d{3}$/.test(group.section),'Invalid section');
  assert(GID.test(group.productId),'Invalid Shopify product ID');
  assert(!products.has(group.productId),'Product ID reused across sections');products.add(group.productId);
  assert(Array.isArray(group.proposed_variants)&&group.proposed_variants.length>0,'Section missing variants');
  assert(group.proposed_variants.length+Number(group.existing_variant_count)<=2048,'Shopify product variant limit exceeded');
  const variants=[];
  for(const v of group.proposed_variants){
   const m=SKU.exec(v.sku||'');assert(m&&m[1]===group.section,'Seat SKU does not match section');
   assert(!skus.has(v.sku),'Duplicate seat SKU');skus.add(v.sku);
   assert(/^\d+\.\d{2}$/.test(v.price)&&Number(v.price)>0,'Invalid price');
   assert(v.inventoryPolicy==='DENY'&&v.inventoryItem?.tracked===true&&v.inventoryItem?.sku===v.sku,'Unsafe inventory configuration');
   assert(Array.isArray(v.optionValues)&&v.optionValues.length===2&&v.optionValues[0].optionName==='Row'&&v.optionValues[1].optionName==='Seat','Expected Row and Seat product options');
   assert(v.optionValues[0].name===m[2]&&Number(v.optionValues[1].name)===Number(m[3]),'Seat options do not match SKU');
   variants.push({price:v.price,inventoryPolicy:'DENY',inventoryItem:{sku:v.sku,tracked:true},optionValues:v.optionValues});
  }
  for(let offset=0;offset<variants.length;offset+=batchSize){
   const chunk=variants.slice(offset,offset+batchSize);
   batches.push({section:group.section,part:1+Math.floor(offset/batchSize),seat_skus:chunk.map(x=>x.inventoryItem.sku),request:{query:MUTATION,variables:{productId:group.productId,variants:chunk}},preconditions:['Product remains DRAFT','Product already has Row and Seat options','Placeholder variant must remain unsellable','Inventory quantities must remain zero','Re-query product SKUs before every batch','Stop immediately on Shopify userErrors or any ambiguous API response']});
  }
  total+=variants.length;
 }
 assert(total===3737&&skus.size===3737,'Incomplete or duplicated 3,737-seat inventory');
 return {version:'V72',mode:'OFFLINE_MUTATION_PAYLOADS_ONLY',executed:false,shopify_writes:0,d1_writes:0,sales_enabled:false,requires_human_review:true,seat_count:total,section_count:products.size,batch_count:batches.length,critical_warning:'Never execute these payloads automatically. Independently approve seat map and prices, verify Shopify options, product IDs, and placeholder inventory; inspect each batch result before the next.',batches};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw Error('Usage: node tools/build-season-variant-batches.mjs approved-plan.json output.json');const plan=JSON.parse(readFileSync(process.argv[2],'utf8'));const result=buildBatches(plan);writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({mode:result.mode,batches:result.batch_count,seats:result.seat_count,executed:false}));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
