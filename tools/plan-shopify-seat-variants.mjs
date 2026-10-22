/** V42: OFFLINE Shopify seat variant planning. Never contacts Shopify or changes products.
 * node tools/plan-shopify-seat-variants.mjs d1-seats.csv approved-manifest.csv shopify-products.csv [output.json]
 * Required independently sourced CSVs. Do NOT fabricate approved manifests from staging.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const SEAT=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
export function parseCSV(source){
 const records=[];let row=[],field='',quoted=false;source=String(source).replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else if(field===''||quoted)quoted=!quoted;else throw Error('Invalid CSV quote');}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote');row.push(field);if(row.some(x=>x.trim()))records.push(row);
 if(!records.length)throw Error('Empty CSV');const [headers,...rows]=records;const h=headers.map(x=>x.trim());if(h.some(x=>!x)||new Set(h).size!==h.length)throw Error('Invalid or duplicate CSV columns');
 return rows.map((r,i)=>{if(r.length!==h.length)throw Error('CSV row '+(i+2)+' has incorrect column count');return Object.fromEntries(h.map((k,j)=>[k,r[j].trim()]));});
}
function columns(rows,keys,label){if(!rows.length)throw Error(label+' has no rows');for(const key of keys)if(!(key in rows[0]))throw Error(label+' missing column '+key);}
function cents(value){return /^\d+$/.test(String(value))?Number(value):NaN;}
function uniq(rows,key,label,errors){const map=new Map();for(const x of rows){if(!x[key]||map.has(x[key]))errors.push(label+' missing/duplicate '+key+': '+x[key]);else map.set(x[key],x);}return map;}
export function planVariants(seats,approved,products){
 columns(seats,['sku','section','row_label','seat_number','price_cents','status','shopify_variant_id'],'D1 seats');
 columns(approved,['sku','section','row_label','seat_number','price_cents','approved'],'Independent manifest');
 columns(products,['section','product_id','product_sku','product_status','variant_count'],'Shopify products');
 const errors=[],seatMap=uniq(seats,'sku','D1',errors),manifestMap=uniq(approved,'sku','Manifest',errors),productMap=uniq(products,'section','Shopify products',errors),groups=new Map();
 for(const s of seats){
  const m=SEAT.exec(s.sku||'');if(!m||m[1]!==s.section||m[2]!==s.row_label||Number(m[3])!==Number(s.seat_number))errors.push('Invalid D1 seat identity: '+s.sku);
  if(s.status!=='UNRELEASED')errors.push('Seat already released: '+s.sku);
  if(s.shopify_variant_id?.trim())errors.push('Seat already mapped; never blindly recreate: '+s.sku);
  const a=manifestMap.get(s.sku);if(!a||a.approved!=='YES')errors.push('Missing independent approval: '+s.sku);
  else if(a.section!==s.section||a.row_label!==s.row_label||Number(a.seat_number)!==Number(s.seat_number)||cents(a.price_cents)!==cents(s.price_cents))errors.push('Manifest identity/price mismatch: '+s.sku);
  const p=productMap.get(s.section);if(!p||!/^gid:\/\/shopify\/Product\/\d+$/.test(p.product_id)||p.product_sku!=='WM-ST-SEC-'+s.section||p.product_status!=='DRAFT')errors.push('Missing/invalid DRAFT section product: '+s.section);
  if(!Number.isSafeInteger(cents(s.price_cents))||cents(s.price_cents)<=0)errors.push('Invalid seat price: '+s.sku);
  if(p&&(!/^\d+$/.test(p.variant_count)||Number(p.variant_count)<1))errors.push('Invalid product variant count: '+s.section);
  if(!groups.has(s.section))groups.set(s.section,[]);groups.get(s.section).push(s);
 }
 for(const sku of manifestMap.keys())if(!seatMap.has(sku))errors.push('Manifest contains unknown seat: '+sku);
 for(const section of productMap.keys())if(!groups.has(section))errors.push('Shopify product has no seats in D1: '+section);
 if(seats.length!==3737)errors.push('Staging count must be 3,737, got '+seats.length);
 if(groups.size!==63)errors.push('Staging sections must be 63, got '+groups.size);
 // Shopify supports up to 2,048 variants per product; leave room for existing variants.
 for(const [section,list] of groups){const p=productMap.get(section);if(p&&list.length+Number(p.variant_count)>2048)errors.push('Variant capacity exceeded: '+section);}
 const ready=errors.length===0;
 const result={version:'V42',mode:'OFFLINE_PLAN_ONLY',ready_to_generate_payloads:ready,sales_enabled:false,shopify_mutations_performed:0,seat_count:seats.length,section_count:groups.size,blocker_count:errors.length,blockers:errors.slice(0,100),blockers_truncated:Math.max(0,errors.length-100),sections:[]};
 if(!ready)return result;
 for(const [section,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){const p=productMap.get(section);
  const variants=list.sort((a,b)=>a.row_label.localeCompare(b.row_label)||Number(a.seat_number)-Number(b.seat_number)).map(s=>({sku:s.sku,price:(cents(s.price_cents)/100).toFixed(2),inventoryPolicy:'DENY',inventoryItem:{tracked:true,sku:s.sku},optionValues:[{optionName:'Row',name:s.row_label},{optionName:'Seat',name:String(Number(s.seat_number))}]}));
  result.sections.push({section,productId:p.product_id,requires_product_options:['Row','Seat'],existing_variant_count:Number(p.variant_count),seat_count:variants.length,proposed_variants:variants,notes:'Planning data only. Before calling variantsBulkCreate, configure product options, remove/replace placeholder variant safely, and verify actual existing Shopify variants.'});
 }
 return result;
}
const isCLI=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(isCLI){try{if(process.argv.length<5||process.argv.length>6)throw Error('Usage: node tools/plan-shopify-seat-variants.mjs d1-seats.csv approved-manifest.csv shopify-products.csv [output.json]');const result=planVariants(...process.argv.slice(2,5).map(p=>parseCSV(readFileSync(p,'utf8'))));const body=JSON.stringify(result,null,2);if(process.argv[5])writeFileSync(process.argv[5],body+'\n');else console.log(body);process.exitCode=result.blocker_count?1:0;}catch(e){console.error(e.message);process.exitCode=2;}}
