/** Wheeling Miners V36 read-only seat availability API.
 * Attach this fetch handler to the existing Cloudflare Worker routing; do not
 * replace the site's main fetch handler or deploy as a standalone Worker.
 * Binding: env.SEAT_DB (Cloudflare D1).
 * Ticket sales intentionally remain disabled.
 */
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reply = (data, status=200) => new Response(JSON.stringify(data), {status,headers:HEADERS});
export async function handleSeatApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/seats/')) return null;
  if (request.method !== 'GET') return reply({error:'Sales and reservation endpoints are disabled until checkout integration is complete.'},405);
  if (!env.SEAT_DB) return reply({error:'Seat database is not configured.'},503);
  if (url.pathname === '/api/seats/status') {
    const summary = await env.SEAT_DB.prepare('SELECT status,COUNT(*) AS count FROM seats GROUP BY status').all();
    return reply({mode:'STAGING',checkout_enabled:false,inventory:summary.results});
  }
  const m = /^\/api\/seats\/section\/(\d{3})$/.exec(url.pathname);
  if (!m) return reply({error:'Unknown seat endpoint.'},404);
  const section=m[1];
  const result=await env.SEAT_DB.prepare('SELECT sku,row_label AS row,seat_number,price_cents,status FROM seats WHERE section=? ORDER BY row_label,seat_number DESC').bind(section).all();
  if (!result.results.length) return reply({error:'Section not found.'},404);
  return reply({section,mode:'STAGING',checkout_enabled:false,seats:result.results});
}
