/** Read-only complete Shopify seat reconciliation. Never writes to Shopify, D1 or checkout. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const EXPECTED_SEATS=3737,EXPECTED_SECTIONS=63;
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
function parseCSV(s){const lines=s.trim().split(/\r?\n/);const headers=lines.shift().split(',');return lines.map(line=>{const fields=line.split(',').map(x=>x.replace(/^"|"$/g,''));if(fields.length!==headers.length)throw Error('INVALID_CSV');return Object.fromEntries(headers.map((k,i)=>[k,fields[i]]));});}
const d1=parseCSV(readFileSync('data/staging/d1-seats.csv','utf8'));
const approved=parseCSV(readFileSync('data/staging/approved-manifest.csv','utf8'));
const products=parseCSV(readFileSync('data/staging/shopify-products.csv','utf8'));
if(d1.length!==EXPECTED_SEATS||approved.length!==EXPECTED_SEATS||products.length!==EXPECTED_SECTIONS)throw Error('SOURCE_COUNT_MISMATCH');
const d1Map=new Map(d1.map(x=>[x.sku,x]));const approvalMap=new Map(approved.map(x=>[x.sku,x]));
if(d1Map.size!==EXPECTED_SEATS||approvalMap.size!==EXPECTED_SEATS)throw Error('SOURCE_DUPLICATE_SKUS');
for(const s of d1){const a=approvalMap.get(s.sku);if(!a||a.approved!=='YES'||a.section!==s.section||a.row_label!==s.row_label||Number(a.seat_number)!==Number(s.seat_number)||Number(a.price_cents)!==Number(s.price_cents)||s.status!=='UNRELEASED'||s.shopify_variant_id)throw Error('SOURCE_APPROVAL_OR_STATUS_MISMATCH:'+s.sku);}
const domain=process.env.SHOPIFY_SHOP_DOMAIN;const token=process.env.SHOPIFY_ADMIN_TOKEN;
if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain??'')||!token)throw Error('MISSING_SHOPIFY_AUTH');
const query=`query($id:ID!,$cursor:String){product(id:$id){id title status options{name} variants(first:250,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id sku price inventoryQuantity inventoryPolicy}}}}`;
async function graphql(variables){const r=await fetch(`https://${domain}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'X-Shopify-Access-Token':token,'Content-Type':'application/json'},body:JSON.stringify({query,variables})});if(!r.ok)throw Error('SHOPIFY_HTTP_'+r.status);const j=await r.json();if(j.errors?.length)throw Error('SHOPIFY_GRAPHQL_'+JSON.stringify(j.errors).slice(0,400));return j.data?.product;}
const output=[],seenIds=new Set(),seenSkus=new Set(),seenSections=new Set();
for(const p of products){const section=p.section;if(!/^\d{3}$/.test(section)||seenSections.has(section)||p.product_sku!==`WM-ST-SEC-${section}`||p.product_status!=='DRAFT')throw Error('INVALID_SECTION_SOURCE:'+section);seenSections.add(section);
 let cursor=null,page=0,all=[],metadata=null;
 do{if(++page>10)throw Error('PAGINATION_LIMIT:'+section);const data=await graphql({id:p.product_id,cursor});if(!data||data.id!==p.product_id||data.status!=='DRAFT'||data.title!==`Wheeling Miners | Season Tickets | Section ${section}`||data.options?.map(x=>x.name).join(',')!=='Row,Seat')throw Error('UNSAFE_PRODUCT:'+section);metadata=data;all.push(...data.variants.nodes);if(!data.variants.pageInfo.hasNextPage)break;cursor=data.variants.pageInfo.endCursor;if(!cursor)throw Error('MISSING_CURSOR:'+section);}while(true);
 const marker=all.filter(v=>v.sku===p.product_sku);if(marker.length!==1||marker[0].inventoryQuantity!==0)throw Error('MISSING_SAFE_PLACEHOLDER:'+section);
 let sectionSeats=0;for(const v of all){const m=SKU.exec(v.sku??'');if(!m)continue;if(m[1]!==section||seenSkus.has(v.sku)||seenIds.has(v.id))throw Error('DUPLICATE_OR_WRONG_SECTION:'+v.sku);const s=d1Map.get(v.sku);if(!s||s.section!==section||s.row_label!==m[2]||Number(s.seat_number)!==Number(m[3]))throw Error('UNAPPROVED_SHOPIFY_SEAT:'+v.sku);if(!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(v.id)||!/^\d+\.\d{2}$/.test(v.price)||Math.round(Number(v.price)*100)!==Number(s.price_cents)||v.inventoryQuantity!==0||v.inventoryPolicy!=='DENY')throw Error('UNSAFE_VARIANT:'+v.sku);seenSkus.add(v.sku);seenIds.add(v.id);sectionSeats++;output.push({sku:v.sku,variant_id:v.id,product_sku:p.product_sku,price_cents:s.price_cents,inventory_quantity:0,product_status:'DRAFT'});}
 if(sectionSeats!==d1.filter(s=>s.section===section).length)throw Error('SECTION_SEAT_COUNT_MISMATCH:'+section);
 console.log(`Verified section ${section}: ${sectionSeats} seats, ${all.length} total variants`);
}
if(seenSections.size!==EXPECTED_SECTIONS||output.length!==EXPECTED_SEATS||seenSkus.size!==EXPECTED_SEATS)throw Error('INCOMPLETE_SHOPIFY_MAPPING');
output.sort((a,b)=>a.sku.localeCompare(b.sku));mkdirSync('reconciliation-output',{recursive:true});
const cols=['sku','variant_id','product_sku','price_cents','inventory_quantity','product_status'];writeFileSync('reconciliation-output/verified-shopify-variants.csv',[cols.join(','),...output.map(r=>cols.map(k=>r[k]).join(','))].join('\n')+'\n');
writeFileSync('reconciliation-output/verification-report.json',JSON.stringify({status:'VERIFIED',mode:'READ_ONLY',shopify_seats:output.length,sections:seenSections.size,distinct_variant_ids:seenIds.size,source_d1_seats:d1.length,source_approved_seats:approved.length,sales_enabled:false,d1_updated:false},null,2));
console.log('FULL_3737_SHOPIFY_EXPORT_VERIFIED');
