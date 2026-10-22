/** V53: independently supplied manifest vs D1; strictly read-only and fail-closed.
 * Usage: node tools/audit-approved-seat-manifest.mjs d1-seats.csv independently-approved-manifest.csv [report.json]
 * A staging D1 export is NEVER an approval source.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const REQUIRED=['sku','section','row_label','seat_number','price_cents'];
const isInt=x=>/^\d+$/.test(String(x))&&Number.isSafeInteger(Number(x));
function validate(rows,label,extra,issues){
 if(!Array.isArray(rows)||!rows.length)throw Error(label+' must contain rows');
 for(const k of [...REQUIRED,...extra])if(!(k in rows[0]))throw Error(label+' missing '+k);
 const out=new Map();
 for(const r of rows){
  const key=String(r.sku||'');
  if(out.has(key))issues.push({code:'DUPLICATE_'+label,sku:key});
  else out.set(key,r);
  const m=SKU.exec(key);
  if(!m||m[1]!==r.section||m[2]!==r.row_label||!isInt(r.seat_number)||Number(m[3])!==Number(r.seat_number)||!isInt(r.price_cents)||Number(r.price_cents)<=0)issues.push({code:'INVALID_'+label,sku:key});
 }
 return out;
}
export function auditApprovedManifest(d1,manifest,{requireComplete=true}={}){
 const issues=[];
 const db=validate(d1,'D1',['status','shopify_variant_id'],issues);
 const approved=validate(manifest,'MANIFEST',['approved'],issues);
 for(const [sku,s] of db){
  const m=approved.get(sku);
  if(!m){issues.push({code:'NOT_IN_MANIFEST',sku});continue;}
  if(m.approved!=='YES')issues.push({code:'NOT_APPROVED',sku});
  for(const k of ['section','row_label','seat_number','price_cents']){
   const a=k==='seat_number'||k==='price_cents'?Number(s[k]):s[k];
   const b=k==='seat_number'||k==='price_cents'?Number(m[k]):m[k];
   if(a!==b)issues.push({code:'FIELD_MISMATCH',sku,field:k});
  }
  if(s.status!=='UNRELEASED')issues.push({code:'SEAT_NOT_UNRELEASED',sku});
 }
 for(const sku of approved.keys())if(!db.has(sku))issues.push({code:'MANIFEST_SEAT_NOT_IN_D1',sku});
 if(requireComplete){
  if(d1.length!==3737)issues.push({code:'D1_COUNT_MISMATCH',actual:d1.length});
  if(manifest.length!==3737)issues.push({code:'MANIFEST_COUNT_MISMATCH',actual:manifest.length});
  if(new Set(d1.map(x=>x.section)).size!==63)issues.push({code:'D1_SECTION_COUNT_MISMATCH'});
  if(new Set(manifest.map(x=>x.section)).size!==63)issues.push({code:'MANIFEST_SECTION_COUNT_MISMATCH'});
 }
 const issue_counts={};for(const i of issues)issue_counts[i.code]=(issue_counts[i.code]||0)+1;
 return {version:'V53',mode:'OFFLINE_READ_ONLY',approval_source:'EXTERNAL_INPUT_NOT_AUTHENTICATED',manifest_matches_staging:issues.length===0,ready_for_sales:false,shopify_mutations:0,d1_mutations:0,d1_seats:d1.length,manifest_seats:manifest.length,issue_count:issues.length,issue_counts,issues:issues.slice(0,150),issues_truncated:Math.max(0,issues.length-150),required_followup:'Team/arena must independently authenticate and approve the manifest. Matching data alone never authorizes sales.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length<4||process.argv.length>5)throw Error('Usage: node tools/audit-approved-seat-manifest.mjs d1.csv approved-manifest.csv [report.json]');
 const result=auditApprovedManifest(parseCSV(readFileSync(process.argv[2],'utf8')),parseCSV(readFileSync(process.argv[3],'utf8')));
 const output=JSON.stringify(result,null,2)+'\n';if(process.argv[4])writeFileSync(process.argv[4],output,{flag:'wx'});else process.stdout.write(output);
 process.exitCode=result.issue_count?1:0;
 }catch(e){console.error(e.message);process.exitCode=2;}
}
