/** V40: staged inventory, reconciliation and verified Shopify paid-order ingestion.
 * NO public holds, checkout, seat release or mapping writes. Never turn on sales here.
 * SHOPIFY_WEBHOOK_SECRET must be set as a Worker secret before webhook use.
 */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const MAX=8;
function selection(raw){
 if(!Array.isArray(raw)||raw.length<1||raw.length>MAX)throw Error('Choose 1 to 8 seats.');
 const seen=new Set();for(const sku of raw){if(typeof sku!=='string'||!SKU.test(sku))throw Error('Invalid seat SKU.');if(seen.has(sku))throw Error('Duplicate seat selection.');seen.add(sku);}return raw;
}
async function verifyHmac(raw,signature,secret){
 if(!secret||!signature||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));
 const expected=btoa(String.fromCharCode(...mac));
 // Compare all characters without returning early on a mismatch.
 if(expected.length!==signature.length)return false;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^signature.charCodeAt(i);return diff===0;
}
async function paidOrder(request,env){
 if(request.method!=='POST')return respond({error:'Method not allowed.'},405);
 if(!env.SHOPIFY_WEBHOOK_SECRET)return respond({error:'Webhook secret not configured.'},503);
 const raw=await request.arrayBuffer();if(raw.byteLength>1024*1024)return respond({error:'Payload too large.'},413);
 if(!await verifyHmac(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return respond({error:'Invalid webhook signature.'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return respond({error:'Unsupported Shopify topic.'},422);
 let order;try{order=JSON.parse(new TextDecoder().decode(raw));}catch{return respond({error:'Invalid JSON.'},400);}
 if(!order?.id||!Array.isArray(order.line_items))return respond({error:'Missing Shopify order fields.'},422);
 const lines=order.line_items.filter(x=>typeof x.sku==='string'&&SKU.test(x.sku));
 if(lines.length===0)return respond({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 // Fail closed: do not record payment as a sale unless ALL seat-to-variant mappings match.
 // A future atomic fulfillment transaction must also enforce order/seat idempotency.
 const ids=lines.map(x=>x.sku);
 if(new Set(ids).size!==ids.length||lines.some(x=>Number(x.quantity)!==1))return respond({error:'Invalid ticket quantities or duplicate seat SKUs.',requires_reconciliation:true},409);
 const marks=ids.map(()=>'?').join(',');
 const found=await env.SEAT_DB.prepare(`SELECT sku,status,shopify_variant_id,shopify_order_id FROM seats WHERE sku IN (${marks})`).bind(...ids).all();
 const bySku=new Map(found.results.map(x=>[x.sku,x]));
 const mismatch=lines.filter(x=>{
  const s=bySku.get(x.sku);return !s||!s.shopify_variant_id||String(s.shopify_variant_id).split('/').pop()!==String(x.variant_id)||s.status==='BLOCKED'||s.status==='UNRELEASED'||(s.shopify_order_id&&String(s.shopify_order_id)!==String(order.id));
 });
 if(mismatch.length)return respond({error:'Paid order needs manual reconciliation; no seat statuses changed.',requires_reconciliation:true,seat_skus:mismatch.map(x=>x.sku)},409);
 // Intentional staging safety: valid paid orders still require explicit reconciliation.
 // Do not automatically mark SOLD until atomic order + reservation fulfillment is implemented.
 return respond({error:'Verified payment received but fulfillment is disabled; Shopify should retry.',staging:true,requires_reconciliation:true},503);
}
export async function handleSeatApi(request,env){
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/seats/'))return null;
 if(!env.SEAT_DB)return respond({error:'Seat database is not configured.'},503);
 if(path==='/api/seats/webhooks/shopify')return paidOrder(request,env);
 if(request.method==='GET'&&path==='/api/seats/status'){
  const summary=await env.SEAT_DB.prepare('SELECT status,COUNT(*) AS count FROM seats GROUP BY status').all();
  const mapped=await env.SEAT_DB.prepare("SELECT COUNT(*) AS count FROM seats WHERE shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>''").first();
  return respond({mode:'STAGING',checkout_enabled:false,holds_enabled:false,shopify_mapped_seats:mapped?.count||0,inventory:summary.results});
 }
 if(request.method==='GET'&&path==='/api/seats/readiness'){
  const summary=await env.SEAT_DB.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT section) AS sections,
  SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,
  SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
  SUM(CASE WHEN status='HELD' THEN 1 ELSE 0 END) AS held,
  SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold,
  SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,
  SUM(CASE WHEN status='AVAILABLE' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)='') THEN 1 ELSE 0 END) AS available_without_variant FROM seats`).first();
  const duplicates=await env.SEAT_DB.prepare("SELECT COUNT(*) AS n FROM (SELECT shopify_variant_id FROM seats WHERE shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' GROUP BY shopify_variant_id HAVING COUNT(*)>1)").first();
  const issues=[];
  if((summary?.total||0)!==3737)issues.push('Seat count differs from the approved 3,737-seat inventory.');
  if((summary?.sections||0)!==63)issues.push('Section count differs from the 63-section inventory.');
  if((summary?.mapped||0)!==(summary?.total||0))issues.push('Not all seats have Shopify variant mappings.');
  if((duplicates?.n||0)>0)issues.push('Duplicate Shopify variant IDs found.');
  if((summary?.available_without_variant||0)>0)issues.push('Available seats lack Shopify variants.');
  issues.push('Checkout and automatic payment fulfillment remain disabled.');
  return respond({mode:'STAGING',ready_for_sales:false,checkout_enabled:false,holds_enabled:false,inventory:summary,duplicate_variant_ids:duplicates?.n||0,blockers:issues});
 }
 const section=/^\/api\/seats\/section\/(\d{3})$/.exec(path);
 if(request.method==='GET'&&section){
  const result=await env.SEAT_DB.prepare('SELECT sku,row_label AS row,seat_number,price_cents,status FROM seats WHERE section=? ORDER BY row_label,seat_number DESC').bind(section[1]).all();
  if(!result.results.length)return respond({error:'Section not found.'},404);
  return respond({section:section[1],mode:'STAGING',checkout_enabled:false,seats:result.results});
 }
 if(request.method==='POST'&&path==='/api/seats/selection-check'){
  let payload;try{payload=await request.json();}catch{return respond({error:'Expected JSON request body.'},400);}
  let skus;try{skus=selection(payload?.skus);}catch(e){return respond({error:e.message},400);}
  const marks=skus.map(()=>'?').join(',');
  const result=await env.SEAT_DB.prepare(`SELECT sku,status,shopify_variant_id FROM seats WHERE sku IN (${marks})`).bind(...skus).all();
  const bySku=new Map(result.results.map(x=>[x.sku,x]));
  const seats=skus.map(sku=>{const s=bySku.get(sku);return {sku,eligible:false,reason:!s?'UNKNOWN_SEAT':s.status!=='AVAILABLE'?s.status:!s.shopify_variant_id?'SHOPIFY_VARIANT_NOT_MAPPED':'CHECKOUT_NOT_ENABLED'};});
  return respond({mode:'STAGING',can_checkout:false,can_hold:false,seats,total_cents:0,message:'Read-only validation; no inventory changed.'});
 }
 if(request.method==='POST'&&path==='/api/seats/hold')return respond({error:'Seat reservations are not yet open.'},423);
 if(request.method==='POST'&&path==='/api/seats/checkout')return respond({error:'Shopify checkout is not yet enabled.'},423);
 if(request.method!=='GET')return respond({error:'Method not allowed.'},405);
 return respond({error:'Unknown seat endpoint.'},404);
}
