/** Read-only TEST launch diagnostics. No checkout, D1 writes or Shopify mutations. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base='https://wheeling-miners-store-test.bikard.workers.dev';
const findings=[];
const add=(level,code,detail)=>findings.push({level,code,detail});
async function read(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(20000),redirect:'error',headers:{accept:'application/json'}});if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return r.json();}
try{
 const [status,ready]=await Promise.all([read('/api/seats/status'),read('/api/seats/readiness')]);
 const counts=Object.fromEntries((status.inventory||[]).map(x=>[x.status,Number(x.count)]));
 const total=Object.values(counts).reduce((a,b)=>a+b,0);
 if(total!==3737)add('BLOCKER','SEAT_COUNT',`Expected 3737, received ${total}`);
 if(Number(ready.inventory?.sections)!==63)add('BLOCKER','SECTION_COUNT','Expected 63 sections');
 if(Number(status.shopify_mapped_seats)!==3737)add('BLOCKER','VARIANT_MAPPING','Not all seats have Shopify variant IDs');
 if(Number(ready.duplicate_variant_ids)!==0)add('BLOCKER','DUPLICATE_VARIANTS','Duplicate Shopify variant IDs');
 if(counts.SOLD!==2||counts.UNRELEASED!==3735)add('BLOCKER','UNEXPECTED_SEAT_STATES',JSON.stringify(counts));
 if(status.checkout_enabled!==false||status.holds_enabled!==false)add('BLOCKER','UNEXPECTED_PUBLIC_ENABLEMENT','Public checkout or holds unexpectedly enabled');
 else add('BLOCKER','PUBLIC_CHECKOUT_LOCKED','Public holds and checkout are intentionally disabled (safe staging).');
 if(ready.ready_for_sales!==false)add('BLOCKER','UNEXPECTED_READINESS','Staging claims ready for sales');
 for(const issue of ready.blockers||[])add('BLOCKER','READINESS_'+String(issue).replace(/[^A-Z0-9]+/gi,'_').slice(0,50),String(issue));
 const section=await read('/api/seats/section/105');
 for(const sku of ['WM-ST-105-B-01','WM-ST-105-B-02'])if(!section.seats?.some(x=>x.sku===sku&&x.status==='SOLD'))add('BLOCKER','SOLD_FIXTURE_MISMATCH',sku);
}catch(e){add('BLOCKER','TEST_API_UNAVAILABLE',e.message)}
add('REQUIRES_VERIFICATION','SHOPIFY_PUBLISHING_AND_STOCK','Confirm production Shopify variants are published and have sellable inventory before launch. TEST draft/zero-stock products are not purchasable.');
add('REQUIRES_VERIFICATION','END_TO_END_PAYMENT','Verify reservation, Shopify test checkout, signed paid webhook, atomic SOLD transition and replay idempotency before public enablement.');
add('REQUIRES_APPROVAL','PRODUCTION_RELEASE','Never activate public sales or production inventory without explicit approval.');
const lines=['# Wheeling Miners — TEST launch blocker report','',`Generated: ${new Date().toISOString()}`,'','This is a **read-only** diagnostic. It does not enable sales or modify any data.','',...findings.map(f=>`- **${f.level} — ${f.code}:** ${f.detail}`),''];
const report=lines.join('\n');
console.log(report);
if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,report,{flag:'a'});
if(process.env.WM_LAUNCH_REPORT_PATH)writeFileSync(process.env.WM_LAUNCH_REPORT_PATH,JSON.stringify({generatedAt:new Date().toISOString(),findings},null,2));
if(findings.some(f=>['SEAT_COUNT','SECTION_COUNT','VARIANT_MAPPING','DUPLICATE_VARIANTS','UNEXPECTED_SEAT_STATES','UNEXPECTED_PUBLIC_ENABLEMENT','UNEXPECTED_READINESS','SOLD_FIXTURE_MISMATCH','TEST_API_UNAVAILABLE'].includes(f.code))){process.exitCode=1;}
