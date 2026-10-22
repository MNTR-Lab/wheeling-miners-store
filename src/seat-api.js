/** V38 staged reservation engine. Public checkout and holds are disabled by default.
 * Never enable until seat-to-Shopify variant mapping, webhook verification, and
 * inventory reconciliation are tested end to end.
 */
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const HOLD_MINUTES=10;
const MAX_SEATS=8;
export async function handleSeatApi(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/seats/'))return null;
 if(!env.SEAT_DB)return json({error:'Seat database is not configured'},503);
 if(request.method==='GET'&&path==='/api/seats/status'){
  const summary=await env.SEAT_DB.prepare('SELECT status, COUNT(*) AS count FROM seats GROUP BY status').all();
  const mapped=await env.SEAT_DB.prepare('SELECT COUNT(*) AS count FROM seats WHERE shopify_variant_id IS NOT NULL').first();
  return json({mode:'STAGING',checkout_enabled:false,holds_enabled:false,shopify_mapped_seats:mapped.count,inventory:summary.results});
 }
 const section=/^\/api\/seats\/section\/(\d{3})$/.exec(path);
 if(request.method==='GET'&&section){
  const result=await env.SEAT_DB.prepare('SELECT sku,row_label AS row,seat_number,price_cents,status FROM seats WHERE section=? ORDER BY row_label,seat_number DESC').bind(section[1]).all();
  if(!result.results.length)return json({error:'Section not found'},404);
  return json({section:section[1],mode:'STAGING',checkout_enabled:false,seats:result.results});
 }
 if(path==='/api/seats/hold'&&request.method==='POST'){
  // No unauthenticated public holds until checkout mapping and anti-abuse are complete.
  return json({error:'Seat reservations are not yet open. No seats were held.'},423);
 }
 if(path==='/api/seats/checkout'&&request.method==='POST'){
  return json({error:'Shopify checkout is not yet enabled.'},423);
 }
 if(path==='/api/seats/webhooks/shopify'){
  return json({error:'Shopify webhook is not configured.'},503);
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 return json({error:'Unknown seat endpoint'},404);
}
