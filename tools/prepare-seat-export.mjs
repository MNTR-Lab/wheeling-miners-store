/** V43: Convert a read-only Cloudflare D1 JSON query result to the exact CSV
 * expected by V41/V42. Does not connect to D1, Shopify or alter inventory.
 * Usage: node tools/prepare-seat-export.mjs d1-query.json d1-seats.csv
 * D1 query: SELECT sku,section,row_label,seat_number,price_cents,status,
 * shopify_variant_id FROM seats ORDER BY sku;
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const COLUMNS=['sku','section','row_label','seat_number','price_cents','status','shopify_variant_id'];
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export function prepareExport(payload,{requireComplete=true}={}){
 let rows;
 if(Array.isArray(payload)){
  if(payload.length===1&&Array.isArray(payload[0]?.results))rows=payload[0].results;
  else if(payload.every(x=>x&&typeof x==='object'&&!('results' in x)))rows=payload;
  else throw Error('Unrecognized D1 array shape');
 }else if(payload&&Array.isArray(payload.results))rows=payload.results;
 else if(payload&&Array.isArray(payload.result)){
  if(payload.result.length!==1||!Array.isArray(payload.result[0]?.results))throw Error('Expected one D1 query result');
  rows=payload.result[0].results;
 }else throw Error('Expected D1 JSON results');
 if(!rows.length)throw Error('Empty D1 result');
 const seen=new Set(),sections=new Set();
 for(const [i,s] of rows.entries()){
  if(!s||typeof s!=='object')throw Error('Invalid seat record '+i);
  for(const k of COLUMNS.slice(0,-1))if(s[k]===undefined||s[k]===null)throw Error('Missing '+k+' at record '+i);
  const m=SKU.exec(String(s.sku));
  if(!m||m[1]!==String(s.section)||m[2]!==String(s.row_label)||Number(m[3])!==Number(s.seat_number))throw Error('Seat identity mismatch: '+s.sku);
  if(seen.has(s.sku))throw Error('Duplicate seat: '+s.sku);seen.add(s.sku);sections.add(String(s.section));
  if(!Number.isSafeInteger(Number(s.price_cents))||Number(s.price_cents)<=0)throw Error('Invalid price: '+s.sku);
  if(s.status!=='UNRELEASED')throw Error('Inventory is not fully staged: '+s.sku);
  if(s.shopify_variant_id!==null&&s.shopify_variant_id!==undefined&&typeof s.shopify_variant_id!=='string')throw Error('Invalid variant ID: '+s.sku);
 }
 if(requireComplete&&(rows.length!==3737||sections.size!==63))throw Error(`Incomplete D1 export: ${rows.length} seats across ${sections.size} sections; expected 3737 and 63`);
 const sorted=[...rows].sort((a,b)=>String(a.sku).localeCompare(String(b.sku)));
 return {csv:[COLUMNS.join(','),...sorted.map(s=>COLUMNS.map(k=>quote(s[k])).join(','))].join('\n')+'\n',summary:{seats:rows.length,sections:sections.size,mapped:rows.filter(s=>Boolean(s.shopify_variant_id)).length,staging_only:true,shopify_changes:0}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)throw Error('Usage: node tools/prepare-seat-export.mjs d1-query.json d1-seats.csv');
  const data=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=prepareExport(data);
  writeFileSync(process.argv[3],result.csv,{flag:'wx'});
  console.log(JSON.stringify(result.summary));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
