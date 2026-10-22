/** V41 offline, read-only preflight. Node >=18. Does not contact Shopify or change inventory.
 * Usage: node tools/verify-seat-mapping.mjs seats.csv shopify-variants.csv approved-manifest.csv
 * All inputs MUST be independent exports; do not generate the approved manifest from staging rows.
 */
import {readFileSync} from 'node:fs';
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
function csv(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('Unclosed CSV quote');row.push(field);if(row.some(v=>v.trim()))rows.push(row);const [header,...body]=rows;if(!header)throw Error('Empty CSV');return body.map((r,i)=>Object.fromEntries(header.map((h,j)=>[h.trim(),(r[j]||'').trim()])));}
function requireColumns(rows,cols,name){if(!rows.length)throw Error(name+' has no rows');for(const col of cols)if(!(col in rows[0]))throw Error(name+' missing '+col);}
export function audit(seats,variants,approved){
 requireColumns(seats,['sku','section','row_label','seat_number','price_cents','status'],'D1 export');
 requireColumns(variants,['sku','variant_id','product_sku','price_cents','inventory_quantity','product_status'],'Shopify export');
 requireColumns(approved,['sku','section','row_label','seat_number','price_cents','approved'],'Independent approved manifest');
 const issues=[],by=(items,key,label)=>{const map=new Map();for(const x of items){if(!x[key])issues.push(label+' missing '+key);else if(map.has(x[key]))issues.push(label+' duplicate '+key+': '+x[key]);else map.set(x[key],x);}return map;};
 const sm=by(seats,'sku','D1'),vm=by(variants,'sku','Shopify'),am=by(approved,'sku','Manifest');
 const variantIds=new Set();let mapped=0;
 for(const s of seats){const m=SKU.exec(s.sku||'');if(!m||m[1]!==s.section||m[2]!==s.row_label||Number(m[3])!==Number(s.seat_number))issues.push('D1 malformed seat '+s.sku);
 const a=am.get(s.sku);if(!a||a.approved!=='YES')issues.push('Not independently approved: '+s.sku);
 else if(a.section!==s.section||a.row_label!==s.row_label||Number(a.seat_number)!==Number(s.seat_number)||Number(a.price_cents)!==Number(s.price_cents))issues.push('Manifest mismatch: '+s.sku);
 const v=vm.get(s.sku);if(!v){issues.push('Shopify variant missing: '+s.sku);continue;}mapped++;
 if(!v.variant_id||variantIds.has(v.variant_id))issues.push('Missing/duplicate variant ID: '+s.sku);variantIds.add(v.variant_id);
 if(v.product_sku!=='WM-ST-SEC-'+s.section)issues.push('Wrong Shopify product: '+s.sku);
 if(Number(v.price_cents)!==Number(s.price_cents))issues.push('Price mismatch: '+s.sku);
 if(v.product_status!=='DRAFT')issues.push('Product is not draft: '+s.sku);
 if(Number(v.inventory_quantity)!==0)issues.push('Nonzero Shopify inventory during staging: '+s.sku);
 if(s.status!=='UNRELEASED')issues.push('D1 seat released before approval: '+s.sku);
 }
 for(const sku of vm.keys())if(!sm.has(sku))issues.push('Shopify seat absent from D1: '+sku);
 for(const sku of am.keys())if(!sm.has(sku))issues.push('Manifest seat absent from D1: '+sku);
 if(seats.length!==3737)issues.push('D1 count is not expected staging count 3737');
 if(new Set(seats.map(x=>x.section)).size!==63)issues.push('Section count is not 63');
 return {mode:'READ_ONLY',approved_for_release:false,seat_count:seats.length,shopify_mapped:mapped,manifest_approved:seats.filter(s=>am.get(s.sku)?.approved==='YES').length,issue_count:issues.length,issues:issues.slice(0,100),issues_truncated:Math.max(0,issues.length-100),message:'This audit never authorizes sales; requires independent venue/team manifest approval, webhook and checkout end-to-end testing.'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){try{if(process.argv.length!==5)throw Error('Provide D1, Shopify and independently approved manifest CSV paths');const result=audit(...process.argv.slice(2).map(p=>csv(readFileSync(p,'utf8'))));console.log(JSON.stringify(result,null,2));process.exitCode=result.issue_count?1:0;}catch(e){console.error(e.message);process.exitCode=2;}}
