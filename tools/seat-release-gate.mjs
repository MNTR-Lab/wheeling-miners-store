/** V54: fail-closed, offline release checklist aggregator. Never authorizes sales. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function evaluateSeatReleaseGate({manifest,shopify,mapping,operations}={}){
 const blockers=[];
 if(!manifest||manifest.version!=='V53'||manifest.issue_count!==0||manifest.manifest_matches_staging!==true)blockers.push('Independent manifest comparison not clean');
 if(!shopify||shopify.version!=='V52'||shopify.issue_count!==0)blockers.push('Shopify seat audit not clean');
 if(!mapping||mapping.issue_count!==0||mapping.mode!=='READ_ONLY')blockers.push('Read-only D1/Shopify mapping audit not clean');
 // An offline comparison cannot authenticate the venue or prove payment flows.
 if(operations?.venue_manifest_signed_off!==true)blockers.push('Team/arena signed approval not independently verified');
 if(operations?.checkout_end_to_end_passed!==true)blockers.push('Checkout end-to-end test not verified');
 if(operations?.payment_webhook_reconciled!==true)blockers.push('Paid-order webhook reconciliation not verified');
 if(operations?.oversell_prevention_verified!==true)blockers.push('Atomic holds and oversell prevention not verified');
 if(operations?.refund_cancellation_tested!==true)blockers.push('Refund/cancellation process not verified');
 return {version:'V54',mode:'OFFLINE_ASSESSMENT_ONLY',sales_enabled:false,ready_for_sales:false,authorization_granted:false,shopify_mutations:0,d1_mutations:0,checklist_complete:!blockers.length,blockers,notice:'Checklist completion is NOT authorization to publish products, release inventory, or enable checkout. Explicit human approval and separate controlled deployment are required.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length<5||process.argv.length>6)throw Error('Usage: node tools/seat-release-gate.mjs manifest-report.json shopify-report.json mapping-report.json operations.json [output.json]');
 const [manifest,shopify,mapping,operations]=process.argv.slice(2,6).map(p=>JSON.parse(readFileSync(p,'utf8')));
 const result=evaluateSeatReleaseGate({manifest,shopify,mapping,operations});const out=JSON.stringify(result,null,2)+'\n';if(process.argv[6])writeFileSync(process.argv[6],out,{flag:'wx'});else process.stdout.write(out);process.exitCode=result.blockers.length?1:0;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
