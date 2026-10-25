/** Receipt QR token management. Staff-only routes must be mounted behind handleSeatAdmin auth.
 * Tokens are opaque random 256-bit values; only SHA-256 hashes are persisted.
 * A QR URL is proof of possession, NOT proof of payment or identity.
 */
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const ORDER=/^[1-9][0-9]{0,19}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hash(token){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))))}
function tokenValue(){const a=new Uint8Array(32);crypto.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')}
export async function handleReceiptQrAdmin(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/seats/admin/receipt-qr-create','/api/seats/admin/receipt-qr-revoke','/api/seats/admin/receipt-qr-resolve'].includes(path))return null;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 let body;try{const raw=await request.text();if(raw.length>2048)return json({error:'BODY_TOO_LARGE'},413);body=JSON.parse(raw)}catch{return json({error:'INVALID_JSON'},400)}
 if(path.endsWith('resolve')){
  if(typeof body?.code!=='string'||!/^[a-f0-9]{64}$/.test(body.code))return json({error:'INVALID_CODE'},422);
  const digest=await hash(body.code);
  const record=await env.SEAT_DB.prepare('SELECT shopify_order_id FROM seat_receipt_qr WHERE token_hash=? AND revoked_at IS NULL').bind(digest).first();
  return record?json({ok:true,order_id:record.shopify_order_id}):json({error:'RECEIPT_NOT_FOUND'},404);
 }
 const id=body?.order_id;
 if(typeof id!=='string'||!ORDER.test(id))return json({error:'INVALID_ORDER_ID'},422);
 const rows=await env.SEAT_DB.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) sold FROM seats WHERE shopify_order_id=?").bind(id).first();
 if(!rows?.n||rows.n!==rows.sold)return json({error:'PAID_SEATS_NOT_VERIFIED'},409);
 if(path.endsWith('revoke')){
  await env.SEAT_DB.prepare('UPDATE seat_receipt_qr SET revoked_at=CURRENT_TIMESTAMP WHERE shopify_order_id=? AND revoked_at IS NULL').bind(id).run();
  return json({ok:true,order_id:id,revoked:true});
 }
 const existing=await env.SEAT_DB.prepare('SELECT shopify_order_id FROM seat_receipt_qr WHERE shopify_order_id=? AND revoked_at IS NULL').bind(id).first();
 if(existing)return json({error:'ACTIVE_QR_EXISTS_REVOKE_BEFORE_REISSUE'},409);
 const token=tokenValue(),digest=await hash(token);
 await env.SEAT_DB.prepare('INSERT INTO seat_receipt_qr(shopify_order_id,token_hash) VALUES(?,?) ON CONFLICT(shopify_order_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=CURRENT_TIMESTAMP,revoked_at=NULL').bind(id,digest).run();
 // URL is to a public receipt presentation page, NOT an admin endpoint. Do not log the token.
 const receipt_url=`${url.origin}/ticket-receipt.html#code=${token}`;
 return json({ok:true,order_id:id,receipt_url,warning:'Share only with purchaser. QR is not an admission ticket. URL is shown once; store or deliver it securely.'},201);
}
/** Public token lookup: deliberately omits purchaser PII and order ID; staff separately verifies payment. */
export async function handleReceiptQrPublic(request,env){
 const url=new URL(request.url);
 if(url.pathname!=='/api/seats/receipt/lookup')return null;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 let body;try{const raw=await request.text();if(raw.length>256)return json({error:'BODY_TOO_LARGE'},413);body=JSON.parse(raw)}catch{return json({error:'INVALID_JSON'},400)}
 if(typeof body?.code!=='string'||!/^[a-f0-9]{64}$/.test(body.code))return json({error:'INVALID_CODE'},422);
 const digest=await hash(body.code);
 let record;try{record=await env.SEAT_DB.prepare('SELECT shopify_order_id FROM seat_receipt_qr WHERE token_hash=? AND revoked_at IS NULL').bind(digest).first()}catch{return json({error:'RECEIPT_SCHEMA_UNAVAILABLE'},503)}
 if(!record)return json({error:'RECEIPT_NOT_FOUND'},404);
 const seats=await env.SEAT_DB.prepare("SELECT section,row_label,seat_number,status FROM seats WHERE shopify_order_id=? ORDER BY section,row_label,seat_number").bind(record.shopify_order_id).all();
 if(!seats.results?.length||seats.results.some(x=>x.status!=='SOLD'))return json({error:'ORDER_REQUIRES_STAFF_REVIEW'},409);
 const issued=await env.SEAT_DB.prepare('SELECT issued_at FROM seat_ticket_issuance WHERE shopify_order_id=?').bind(record.shopify_order_id).first();
 return json({ok:true,season_tickets:seats.results.map(s=>({section:s.section,row:s.row_label,seat:s.seat_number})),ticket_count:seats.results.length,issuance_status:issued?'ISSUED':'NOT_ISSUED',note:'This receipt is not valid for admission. Present it to authorized staff with proof of purchase.'});
}
