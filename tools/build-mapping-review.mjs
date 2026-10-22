/** V46: produce a guarded, REVIEW-ONLY SQLite mapping script from validated independent exports.
 * Does not connect to D1/Shopify, apply mappings, or authorize seat sales.
 * Cloudflare D1 may not permit manual BEGIN/COMMIT statements via its HTTP query endpoint.
 * Do not run this script directly against production D1. Review and adapt to supported atomic D1 APIs.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
function parseCSV(source){
 const records=[];let row=[],field='',quoted=false;source=String(source).replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else if(field===''||quoted)quoted=!quoted;else throw Error('Invalid CSV quote');}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote');row.push(field);if(row.some(x=>x.trim()))records.push(row);
 if(!records.length)throw Error('Empty CSV');const [headers,...rows]=records;const h=headers.map(x=>x.trim());
 if(h.some(x=>!x)||new Set(h).size!==h.length)throw Error('Invalid CSV columns');
 return rows.map((r,i)=>{if(r.length!==h.length)throw Error('CSV row '+(i+2)+' has incorrect column count');return Object.fromEntries(h.map((k,j)=>[k,r[j].trim()]));});
}
function validate(seats,variants,manifest,requireComplete){
 const issues=[];if(!seats.length||!variants.length||!manifest.length)issues.push('Missing records');
 const m=new Map(),v=new Map(),ids=new Set(),skus=new Set();
 for(const x of manifest){if(m.has(x.sku))issues.push('Duplicate manifest seat');m.set(x.sku,x);}
 for(const x of variants){if(v.has(x.sku))issues.push('Duplicate Shopify seat');v.set(x.sku,x);if(!gid.test(x.variant_id)||ids.has(x.variant_id))issues.push('Invalid or duplicate variant ID');ids.add(x.variant_id);}
 for(const s of seats){
  if(skus.has(s.sku))issues.push('Duplicate D1 seat');skus.add(s.sku);
  const match=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/.exec(s.sku||'');
  if(!match||match[1]!==s.section||match[2]!==s.row_label||Number(match[3])!==Number(s.seat_number))issues.push('Seat identity mismatch '+s.sku);
  if(s.status!=='UNRELEASED'||(s.shopify_variant_id??'').trim())issues.push('Seat already released or mapped '+s.sku);
  const a=m.get(s.sku),x=v.get(s.sku);
  if(!a||a.approved!=='YES'||a.section!==s.section||a.row_label!==s.row_label||Number(a.seat_number)!==Number(s.seat_number)||Number(a.price_cents)!==Number(s.price_cents))issues.push('Independent manifest mismatch '+s.sku);
  if(!x||x.product_sku!=='WM-ST-SEC-'+s.section||Number(x.price_cents)!==Number(s.price_cents)||x.product_status!=='DRAFT'||String(x.inventory_quantity)!=='0')issues.push('Shopify mismatch '+s.sku);
 }
 if(v.size!==skus.size||m.size!==skus.size||[...v.keys(),...m.keys()].some(k=>!skus.has(k)))issues.push('Record set mismatch');
 if(requireComplete&&(seats.length!==3737||new Set(seats.map(s=>s.section)).size!==63))issues.push('Incomplete staging inventory');
 return issues;
}
const gid=/^gid:\/\/shopify\/ProductVariant\/\d+$/;
const esc=x=>"'"+String(x).replaceAll("'","''")+"'";
export function buildMappingReview(seats,variants,manifest,{requireComplete=true}={}){
 const issues=validate(seats,variants,manifest,requireComplete);
 if(issues.length)return {ready:false,issues,sql:null,expected:seats.length};
 const bySku=new Map(variants.map(v=>[v.sku,v]));
 const entries=seats.map(s=>({sku:s.sku,variant:bySku.get(s.sku)?.variant_id})).sort((a,b)=>a.sku.localeCompare(b.sku));
 if(entries.some(e=>!gid.test(e.variant)))throw Error('Invalid variant in audited mapping');
 const expected=entries.length;
 // Guards run within a SQLite transaction. A failed CHECK aborts before COMMIT.
 const sql=[
 '-- V46 REVIEW ONLY. DO NOT RUN DIRECTLY AGAINST CLOUDFLARE D1 HTTP API.',
 '-- Requires independent signed arena manifest and separate Shopify variant verification.',
 '-- This operation ONLY maps variants; it never changes seat status or enables checkout.',
 'BEGIN IMMEDIATE;',
 'CREATE TEMP TABLE _wm_mapping (sku TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE);',
 ...entries.map(e=>`INSERT INTO _wm_mapping(sku,variant_id) VALUES(${esc(e.sku)},${esc(e.variant)});`),
 'CREATE TEMP TABLE _wm_guard (value INTEGER NOT NULL CHECK(value=1));',
 `INSERT INTO _wm_guard SELECT CASE WHEN (SELECT COUNT(*) FROM _wm_mapping)=${expected} AND (SELECT COUNT(*) FROM seats)=${expected} AND (SELECT COUNT(DISTINCT section) FROM seats)=${requireComplete?63:'(SELECT COUNT(DISTINCT section) FROM seats)'} AND (SELECT COUNT(*) FROM seats WHERE status='UNRELEASED' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)=''))=${expected} AND (SELECT COUNT(*) FROM _wm_mapping m JOIN seats s ON s.sku=m.sku)=${expected} THEN 1 ELSE 0 END;`,
 'UPDATE seats SET shopify_variant_id=(SELECT variant_id FROM _wm_mapping WHERE sku=seats.sku),updated_at=CURRENT_TIMESTAMP WHERE sku IN (SELECT sku FROM _wm_mapping) AND status=\'UNRELEASED\' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)=\'\');',
 `INSERT INTO _wm_guard SELECT CASE WHEN (SELECT COUNT(*) FROM seats s JOIN _wm_mapping m ON m.sku=s.sku AND m.variant_id=s.shopify_variant_id)=${expected} AND (SELECT COUNT(*) FROM seats WHERE status='UNRELEASED')=${expected} THEN 1 ELSE 0 END;`,
 'DROP TABLE _wm_guard;',
 'DROP TABLE _wm_mapping;',
 'COMMIT;',
 ''
 ].join('\n');
 return {ready:true,expected,issues:[],sql,sales_enabled:false,executed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==6)throw Error('Usage: node tools/build-mapping-review.mjs d1.csv variants.csv manifest.csv review.sql');
 const result=buildMappingReview(...process.argv.slice(2,5).map(p=>parseCSV(readFileSync(p,'utf8'))));
 if(!result.ready){console.error(JSON.stringify({ready:false,issues:result.issues},null,2));process.exitCode=1;}
 else{writeFileSync(process.argv[5],result.sql,{flag:'wx'});console.log(JSON.stringify({ready:true,expected:result.expected,executed:false,sales_enabled:false}));}
 }catch(e){console.error(e.message);process.exitCode=2;}
}
