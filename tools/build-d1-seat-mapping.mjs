/** Generate a guarded, offline D1 mapping script from independently verified CSV exports.
 * No network requests. Never releases seats or enables checkout.
 * Usage: node tools/build-d1-seat-mapping.mjs seats.csv verified-shopify-variants.csv output.sql
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
function parseCSV(text){
 const lines=String(text).trim().split(/\r?\n/);const cols=lines.shift().split(',').map(x=>x.trim());
 if(new Set(cols).size!==cols.length)throw Error('DUPLICATE_COLUMNS');
 return lines.map(line=>{const values=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));if(values.length!==cols.length)throw Error('INVALID_CSV');return Object.fromEntries(cols.map((c,i)=>[c,values[i]]));});
}
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
export function buildMappingSql(seats,variants,{expectedSeats=3737,expectedSections=63}={}){
 if(!Array.isArray(seats)||!Array.isArray(variants)||seats.length!==expectedSeats||variants.length!==expectedSeats)throw Error('SEAT_COUNT_MISMATCH');
 const bySku=new Map(),ids=new Set(),sections=new Set();
 for(const s of seats){const m=SKU.exec(s.sku??'');if(!m||m[1]!==s.section||m[2]!==s.row_label||Number(m[3])!==Number(s.seat_number)||s.status!=='UNRELEASED'||s.shopify_variant_id||!Number.isSafeInteger(Number(s.price_cents))||Number(s.price_cents)<=0||bySku.has(s.sku))throw Error('INVALID_D1_SEAT:'+s.sku);bySku.set(s.sku,s);sections.add(s.section);}
 if(sections.size!==expectedSections)throw Error('SECTION_COUNT_MISMATCH');
 const seen=new Set(),lines=[];
 for(const v of variants){const s=bySku.get(v.sku);if(!s||seen.has(v.sku)||!GID.test(v.variant_id??'')||ids.has(v.variant_id)||v.product_sku!=='WM-ST-SEC-'+s.section||Number(v.price_cents)!==Number(s.price_cents)||v.product_status!=='DRAFT'||Number(v.inventory_quantity)!==0)throw Error('INVALID_SHOPIFY_VARIANT:'+v.sku);seen.add(v.sku);ids.add(v.variant_id);
  lines.push(`UPDATE seats SET shopify_variant_id=${quote(v.variant_id)},updated_at=CURRENT_TIMESTAMP WHERE sku=${quote(v.sku)} AND status='UNRELEASED' AND shopify_variant_id IS NULL AND price_cents=${Number(s.price_cents)} AND section_product_sku=${quote(v.product_sku)};`);
  lines.push("INSERT INTO seat_admin_guard(id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END);");
  lines.push('DELETE FROM seat_admin_guard WHERE id=1;');
 }
 if(seen.size!==bySku.size)throw Error('MISSING_SHOPIFY_VARIANTS');
 return ['-- OFFLINE GENERATED. BACK UP D1 FIRST. Execute only after approved Shopify catalog verification.','-- All 3,737 seat updates must be atomic; never run partial batches.','-- No publication, inventory release or checkout activation.','BEGIN TRANSACTION;','DELETE FROM seat_admin_guard WHERE id=1;',...lines,'COMMIT;',''].join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==5)throw Error('Usage: node tools/build-d1-seat-mapping.mjs seats.csv variants.csv output.sql');const sql=buildMappingSql(parseCSV(readFileSync(process.argv[2],'utf8')),parseCSV(readFileSync(process.argv[3],'utf8')));writeFileSync(process.argv[4],sql,{flag:'wx',mode:0o600});console.log('Validated full mapping; generated offline SQL; no database changes made.');}catch(e){console.error(e.message);process.exitCode=1;}}
