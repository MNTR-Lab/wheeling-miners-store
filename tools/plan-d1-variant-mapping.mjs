/** V45: Produce review-only D1 mapping SQL. Never executes SQL or changes inventory.
 * node tools/plan-d1-variant-mapping.mjs d1-seats.csv shopify-seat-variants.csv approved-manifest.csv output.sql
 * Input files MUST be independently sourced. This planner cannot approve seats or sales.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseCSV} from './plan-shopify-seat-variants.mjs';
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/(\d+)$/;
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
function index(rows,name,issues){const map=new Map();for(const r of rows){if(!r.sku||map.has(r.sku))issues.push(`${name}: missing or duplicate SKU ${r.sku}`);else map.set(r.sku,r);}return map;}
function fields(rows,keys,label){if(!rows.length)throw Error(label+' is empty');for(const k of keys)if(!(k in rows[0]))throw Error(label+' missing '+k);}
export function planMapping(seats,variants,manifest,{requireComplete=true}={}){
 fields(seats,['sku','section','row_label','seat_number','price_cents','status','shopify_variant_id'],'D1');
 fields(variants,['sku','variant_id','product_sku','price_cents','inventory_quantity','product_status'],'Shopify');
 fields(manifest,['sku','section','row_label','seat_number','price_cents','approved'],'Manifest');
 const issues=[],sm=index(seats,'D1',issues),vm=index(variants,'Shopify',issues),am=index(manifest,'Manifest',issues),ids=new Set(),statements=[];
 for(const s of seats){
  const m=SKU.exec(s.sku||'');if(!m||m[1]!==s.section||m[2]!==s.row_label||Number(m[3])!==Number(s.seat_number))issues.push(`Invalid seat identity ${s.sku}`);
  if(s.status!=='UNRELEASED'||s.shopify_variant_id)issues.push(`Seat not unmapped/unreleased ${s.sku}`);
  const a=am.get(s.sku);if(!a||a.approved!=='YES'||a.section!==s.section||a.row_label!==s.row_label||Number(a.seat_number)!==Number(s.seat_number)||Number(a.price_cents)!==Number(s.price_cents))issues.push(`Independent approval mismatch ${s.sku}`);
  const v=vm.get(s.sku);if(!v){issues.push(`Missing Shopify variant ${s.sku}`);continue;}
  const id=GID.exec(v.variant_id||'');if(!id||ids.has(id[1]))issues.push(`Invalid/duplicate Shopify variant ${s.sku}`);else ids.add(id[1]);
  if(v.product_sku!==`WM-ST-SEC-${s.section}`||Number(v.price_cents)!==Number(s.price_cents)||v.product_status!=='DRAFT'||v.inventory_quantity!=='0')issues.push(`Shopify product, price, draft status or zero-inventory mismatch ${s.sku}`);
  if(id)statements.push(`UPDATE seats SET shopify_variant_id=${q(v.variant_id)},updated_at=CURRENT_TIMESTAMP WHERE sku=${q(s.sku)} AND status='UNRELEASED' AND shopify_variant_id IS NULL;`);
 }
 for(const sku of vm.keys())if(!sm.has(sku))issues.push(`Unknown Shopify SKU ${sku}`);
 for(const sku of am.keys())if(!sm.has(sku))issues.push(`Unknown manifest SKU ${sku}`);
 if(requireComplete&&(seats.length!==3737||new Set(seats.map(s=>s.section)).size!==63))issues.push('Incomplete staging inventory (expected 3737 seats / 63 sections)');
 const ready=issues.length===0;
 // SQL is never emitted if ANY validation fails. SQL is a review artifact, not an automatic release.
 const sql=ready?`-- REVIEW ONLY. DO NOT EXECUTE until Shopify seat variants exist and independent arena manifest is signed off.\n-- This maps variants only; it does NOT make seats AVAILABLE or enable checkout.\n-- Apply in a transaction with row count verification and backup.\n${statements.sort().join('\n')}\n`:null;
 return {ready_for_manual_mapping_review:ready,sales_enabled:false,executed:false,seat_count:seats.length,statement_count:ready?statements.length:0,issue_count:issues.length,issues:issues.slice(0,100),issues_truncated:Math.max(0,issues.length-100),sql};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==6)throw Error('Usage: node tools/plan-d1-variant-mapping.mjs d1.csv variants.csv manifest.csv output.sql');const r=planMapping(...process.argv.slice(2,5).map(p=>parseCSV(readFileSync(p,'utf8'))));console.log(JSON.stringify({...r,sql:undefined},null,2));if(!r.ready_for_manual_mapping_review)process.exitCode=1;else writeFileSync(process.argv[5],r.sql,{flag:'wx'});}catch(e){console.error(e.message);process.exitCode=2;}}
