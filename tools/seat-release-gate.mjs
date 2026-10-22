/** V55: fail-closed, offline release checklist aggregator. Never authorizes sales. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const cleanCount=x=>Number.isSafeInteger(x)&&x===0;
export function evaluateSeatReleaseGate({manifest,shopify,mapping,operations}={}){
 const blockers=[];
 if(!isObject(manifest)||manifest.version!=='V53'||!cleanCount(manifest.issue_count)||manifest.manifest_matches_staging!==true||manifest.mode!=='OFFLINE_READ_ONLY'||manifest.ready_for_sales!==false||manifest.shopify_mutations!==0||manifest.d1_mutations!==0){
  blockers.push('Independent manifest comparison not clean or report invalid');
 }
 if(!isObject(shopify)||shopify.version!=='V52'||!cleanCount(shopify.issue_count)||shopify.mode!=='READ_ONLY'||shopify.ready_for_sales!==false||shopify.sales_enabled!==false||shopify.shopify_mutations!==0||shopify.d1_mutations!==0){
  blockers.push('Shopify seat audit not clean or report invalid');
 }
 if(!isObject(mapping)||!cleanCount(mapping.issue_count)||mapping.mode!=='READ_ONLY'||mapping.approved_for_release!==false){
  blockers.push('Read-only D1/Shopify mapping audit not clean or report invalid');
 }
 if(!isObject(operations))operations={};
 const checks=[
  ['venue_manifest_signed_off','Team/arena signed approval not independently verified'],
  ['checkout_end_to_end_passed','Checkout end-to-end test not verified'],
  ['payment_webhook_reconciled','Paid-order webhook reconciliation not verified'],
  ['oversell_prevention_verified','Atomic holds and oversell prevention not verified'],
  ['refund_cancellation_tested','Refund/cancellation process not verified']
 ];
 for(const [field,message] of checks)if(operations[field]!==true)blockers.push(message);
 return {version:'V55',mode:'OFFLINE_ASSESSMENT_ONLY',sales_enabled:false,ready_for_sales:false,authorization_granted:false,shopify_mutations:0,d1_mutations:0,checklist_complete:blockers.length===0,blockers,notice:'Checklist completion is NOT authorization to publish products, release inventory, or enable checkout. Explicit human approval and separate controlled deployment are required.'};
}
function main(args){
 if(args.length!==4&&args.length!==5)throw Error('Usage: node tools/seat-release-gate.mjs manifest-report.json shopify-report.json mapping-report.json operations.json [output.json]');
 const [manifest,shopify,mapping,operations]=args.slice(0,4).map(p=>JSON.parse(readFileSync(p,'utf8')));
 const result=evaluateSeatReleaseGate({manifest,shopify,mapping,operations});
 const out=JSON.stringify(result,null,2)+'\n';
 if(args[4])writeFileSync(args[4],out,{flag:'wx'});else process.stdout.write(out);
 return result.blockers.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){console.error(e.message);process.exitCode=2;}
}
