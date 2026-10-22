/** Manual, one-section-at-a-time draft-only runner. Does not publish or release seats. */
import {readFileSync} from 'node:fs';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
import {makeShopify,stageOptions,stageBatch} from './shopify-season-safe-runner.mjs';
const [mode,section,partArg='1',flag='dry-run']=process.argv.slice(2);
if(!['options','variants'].includes(mode)||!/^\d{3}$/.test(section||'')||!['dry-run','execute'].includes(flag))throw Error('Usage: node tools/run-approved-seat-section.mjs options|variants SECTION PART dry-run|execute');
const execute=flag==='execute';
if(execute&&process.env.WM_SEASON_WRITE_CONFIRM!==`I_APPROVE_DRAFT_SECTION_${section}`)throw Error('Explicit section approval missing');
const products=parseCSV(readFileSync('data/staging/shopify-products.csv','utf8'));
if(products.length!==63)throw Error('Expected exactly 63 Shopify draft section products');
const p=products.find(x=>x.section===section);
if(!p||p.product_status!=='DRAFT'||p.product_sku!==`WM-ST-SEC-${section}`||!/^gid:\/\/shopify\/Product\/\d+$/.test(p.product_id))throw Error('Unapproved section product');
const batches=JSON.parse(readFileSync('data/staging/shopify-variant-batches.json','utf8'));
if(batches.mode!=='OFFLINE_MUTATION_PAYLOADS_ONLY'||batches.seat_count!==3737||batches.section_count!==63||batches.sales_enabled!==false||batches.batches?.length!==105)throw Error('Unapproved batch plan');
const sectionBatches=batches.batches.filter(b=>b.section===section);
if(!sectionBatches.length||sectionBatches.some(b=>b.request?.variables?.productId!==p.product_id))throw Error('Product ID mismatch');
const graphql=makeShopify({domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_TOKEN});
if(mode==='options'){
 const result=await stageOptions({graphql,id:p.product_id,section,execute});console.log(JSON.stringify(result,null,2));
}else{
 if(!/^\d+$/.test(partArg))throw Error('Invalid batch number');
 if(execute&&process.env.WM_SEAT_MAP_PRICE_APPROVED!=='YES')throw Error('Approval missing');
 const batch=sectionBatches.find(b=>b.part===Number(partArg));if(!batch)throw Error('No batch '+partArg+' for '+section);
 const result=await stageBatch({graphql,id:p.product_id,section,batch,execute});console.log(JSON.stringify(result,null,2));
}
