/** V78 offline conversion of a complete Shopify export into the V45 D1 mapping input. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
function csv(rows){const columns=['sku','variant_id','product_sku','price_cents','inventory_quantity','product_status'];return [columns.join(','),...rows.map(r=>columns.map(k=>`"${String(r[k]).replaceAll('"','""')}"`).join(','))].join('\n')+'\n';}
export function exportVerified(payload,{expectedSeats=3737,expectedSections=63}={}){
 const root=payload?.data?.products??payload?.products??payload;
 if(root?.pageInfo?.hasNextPage)throw Error('Incomplete product pagination');
 const products=Array.isArray(root)?root:root?.nodes??root?.edges?.map(e=>e.node);
 if(!Array.isArray(products))throw Error('Invalid Shopify export');
 const seen=new Set(),sections=new Set(),rows=[],issues=[];
 for(const p of products){
  if(p.variants?.pageInfo?.hasNextPage)throw Error('Incomplete variant pagination');
  const vs=p.variants?.nodes??p.variants?.edges?.map(e=>e.node);
  if(!Array.isArray(vs))throw Error('Missing Shopify variants');
  const markers=vs.filter(v=>/^WM-ST-SEC-\d{3}$/.test(v.sku||''));
  if(!markers.length)continue;
  if(p.status==='ARCHIVED')continue;
  if(markers.length!==1||p.status!=='DRAFT')issues.push('Invalid section product '+p.id);
  const section=markers[0]?.sku?.slice(-3);
  if(!section)continue;
  if(sections.has(section))issues.push('Duplicate active section '+section);sections.add(section);
  if(p.title!==`Wheeling Miners | Season Tickets | Section ${section}`)issues.push('Title mismatch '+section);
  if(p.options?.map(x=>x.name).join(',')!=='Row,Seat')issues.push('Options missing '+section);
  if(markers[0].inventoryQuantity!==0)issues.push('Placeholder inventory nonzero '+section);
  for(const v of vs){const m=SKU.exec(v.sku||'');if(!m)continue;
   if(m[1]!==section||seen.has(v.sku))issues.push('Duplicate/wrong seat '+v.sku);seen.add(v.sku);
   if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id||''))issues.push('Invalid variant ID '+v.sku);
   if(!/^\d+\.\d{2}$/.test(v.price||'')||v.inventoryQuantity!==0||v.inventoryPolicy!=='DENY')issues.push('Unsafe variant '+v.sku);
   const price_cents=Math.round(Number(v.price)*100);
   rows.push({sku:v.sku,variant_id:v.id,product_sku:markers[0].sku,price_cents,inventory_quantity:v.inventoryQuantity,product_status:p.status});
  }
 }
 if(sections.size!==expectedSections)issues.push(`Expected ${expectedSections} sections, found ${sections.size}`);
 if(rows.length!==expectedSeats)issues.push(`Expected ${expectedSeats} seats, found ${rows.length}`);
 rows.sort((a,b)=>a.sku.localeCompare(b.sku));
 return {ready:issues.length===0,sections:sections.size,seats:rows.length,issues,mode:'OFFLINE_ONLY',sales_enabled:false,csv:issues.length?null:csv(rows)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==4)throw Error('Usage: node tools/export-verified-seat-variants.mjs complete-shopify-export.json mapping-input.csv');const r=exportVerified(JSON.parse(readFileSync(process.argv[2],'utf8')));if(!r.ready)throw Error(JSON.stringify(r.issues.slice(0,20)));writeFileSync(process.argv[3],r.csv,{flag:'wx',mode:0o600});console.log(JSON.stringify({seats:r.seats,sections:r.sections,ready:r.ready,writes:0}));}catch(e){console.error(e.message);process.exitCode=1;}}
