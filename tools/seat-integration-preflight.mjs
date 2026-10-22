/** V57: offline, read-only integration preflight. Never enables ticket sales. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
import {auditShopifyReadiness} from './audit-shopify-seat-readiness.mjs';

export function integrationPreflight(seats,shopifyExport){
 if(!shopifyExport || shopifyExport.meta?.mode!=='READ_ONLY'||shopifyExport.meta?.sales_enabled!==false)throw Error('Expected complete V56 read-only Shopify export');
 const products=shopifyExport.data?.products;
 if(!Array.isArray(products?.nodes)||products.pageInfo?.hasNextPage!==false)throw Error('Incomplete Shopify product export');
 const actualVariants=products.nodes.reduce((n,p)=>{
  if(!Array.isArray(p.variants?.nodes)||p.variants.pageInfo?.hasNextPage!==false)throw Error('Incomplete variants for '+p.id);
  return n+p.variants.nodes.length;
 },0);
 if(shopifyExport.meta.product_count!==products.nodes.length||shopifyExport.meta.variant_count!==actualVariants)throw Error('Shopify export metadata does not match records');
 const audit=auditShopifyReadiness(seats,shopifyExport);
 const stages={
  d1_export_loaded:seats.length>0,
  shopify_export_complete:true,
  independent_venue_manifest_approved:false,
  variant_audit_clean:audit.issue_count===0,
  atomic_reservations_tested:false,
  shopify_checkout_tested:false,
  payment_reconciliation_tested:false
 };
 return {version:'V57',mode:'OFFLINE_READ_ONLY',sales_enabled:false,ready_for_sales:false,shopify_mutations:0,d1_mutations:0,seat_count:seats.length,shopify_product_count:products.nodes.length,shopify_variant_count:actualVariants,stages,issue_count:audit.issue_count,issue_counts:audit.issue_counts,issues:audit.issues,issues_truncated:audit.issues_truncated,blockers:[...Object.entries(stages).filter(([,ok])=>!ok).map(([key])=>key),...(audit.issue_count?['shopify_d1_discrepancies']:[])],notice:'This report is diagnostic only. It cannot authorize publishing, inventory release, holds or checkout.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4&&process.argv.length!==5)throw Error('Usage: node tools/seat-integration-preflight.mjs d1-seats.csv shopify-export.json [output.json]');
  const seats=parseCSV(readFileSync(process.argv[2],'utf8'));
  const shopify=JSON.parse(readFileSync(process.argv[3],'utf8'));
  const result=integrationPreflight(seats,shopify);
  const json=JSON.stringify(result,null,2)+'\n';
  if(process.argv[4])writeFileSync(process.argv[4],json,{flag:'wx',mode:0o600});else process.stdout.write(json);
  process.exitCode=result.issue_count?1:0;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
