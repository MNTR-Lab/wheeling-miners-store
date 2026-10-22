/** V39 seat readiness and mapping preflight. NO write routes, holds, or checkout.
 * Every inventory query is served from D1; never infer availability from map geometry.
 */
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const VALID_SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const MAX_SELECTION=8;
function parseSelection(input){
 if(!Array.isArray(input)||input.length===0||input.length>MAX_SELECTION)throw Error('Choose 1 to 8 seats.');
 const seen=new Set(),out=[];
 for(const raw of input){
  if(typeof raw!=='string'||!VALID_SKU.test(raw))throw Error('Invalid seat SKU.');
  if(seen.has(raw))throw Error('Duplicate seat selection.');
  seen.add(raw);out.push(raw);
 }
 return out;
}
export async function handleSeatApi(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/seats/'))return null;
 if(!env.SEAT_DB)return json({error:'Seat database is not configured.'},503);
 if(request.method==='GET'&&path==='/api/seats/status'){
  const summary=await env.SEAT_DB.prepare('SELECT status,COUNT(*) AS count FROM seats GROUP BY status').all();
  const mapped=await env.SEAT_DB.prepare('SELECT COUNT(*) AS count FROM seats WHERE shopify_variant_id IS NOT NULL').first();
  return json({mode:'STAGING',checkout_enabled:false,holds_enabled:false,shopify_mapped_seats:mapped?.count||0,inventory:summary.results});
 }
 if(request.method==='GET'&&path==='/api/seats/readiness'){
  const summary=await env.SEAT_DB.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT section) AS sections,
   SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,
   SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
   SUM(CASE WHEN status='HELD' THEN 1 ELSE 0 END) AS held,
   SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold,
   SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,
   SUM(CASE WHEN status='AVAILABLE' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)='') THEN 1 ELSE 0 END) AS available_without_variant
   FROM seats`).first();
  const duplicates=await env.SEAT_DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT shopify_variant_id FROM seats WHERE shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' GROUP BY shopify_variant_id HAVING COUNT(*)>1)`).first();
  const issues=[];
  if((summary?.total||0)!==3737)issues.push('Seat count differs from the 3,737-seat approved staging inventory.');
  if((summary?.sections||0)!==63)issues.push('Section count differs from the 63-section staging inventory.');
  if((summary?.mapped||0)!==(summary?.total||0))issues.push('Not all seats have unique Shopify variant mappings.');
  if((duplicates?.n||0)>0)issues.push('A Shopify variant ID is assigned to more than one seat.');
  if((summary?.available_without_variant||0)>0)issues.push('Some available seats have no Shopify variant.');
  issues.push('Checkout integration and verified payment webhooks are not enabled.');
  return json({mode:'STAGING',ready_for_sales:false,checkout_enabled:false,holds_enabled:false,inventory:summary,duplicate_variant_ids:duplicates?.n||0,blockers:issues});
 }
 const section=/^\/api\/seats\/section\/(\d{3})$/.exec(path);
 if(request.method==='GET'&&section){
  const result=await env.SEAT_DB.prepare('SELECT sku,row_label AS row,seat_number,price_cents,status FROM seats WHERE section=? ORDER BY row_label,seat_number DESC').bind(section[1]).all();
  if(!result.results.length)return json({error:'Section not found.'},404);
  return json({section:section[1],mode:'STAGING',checkout_enabled:false,seats:result.results});
 }
 if(request.method==='POST'&&path==='/api/seats/selection-check'){
  let payload;
  try{payload=await request.json();}catch{return json({error:'Expected JSON request body.'},400);}
  let skus;
  try{skus=parseSelection(payload?.skus);}catch(error){return json({error:error.message},400);}
  const marks=skus.map(()=>'?').join(',');
  const result=await env.SEAT_DB.prepare(`SELECT sku,section,row_label AS row,seat_number,price_cents,status,shopify_variant_id FROM seats WHERE sku IN (${marks})`).bind(...skus).all();
  const bySku=new Map(result.results.map(x=>[x.sku,x]));
  const seats=skus.map(sku=>{
   const seat=bySku.get(sku);
   if(!seat)return {sku,eligible:false,reason:'UNKNOWN_SEAT'};
   if(seat.status!=='AVAILABLE')return {sku,eligible:false,reason:seat.status};
   if(!seat.shopify_variant_id)return {sku,eligible:false,reason:'SHOPIFY_VARIANT_NOT_MAPPED'};
   return {sku,eligible:false,reason:'CHECKOUT_NOT_ENABLED'};
  });
  return json({mode:'STAGING',can_checkout:false,can_hold:false,seats,total_cents:0,message:'Read-only validation; no inventory changed and no reservation created.'});
 }
 if(path==='/api/seats/hold'&&request.method==='POST')return json({error:'Seat reservations are not yet open. No seats were held.'},423);
 if(path==='/api/seats/checkout'&&request.method==='POST')return json({error:'Shopify checkout is not yet enabled.'},423);
 if(path==='/api/seats/webhooks/shopify')return json({error:'Shopify webhook is not configured.'},503);
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 return json({error:'Unknown seat endpoint.'},404);
}
