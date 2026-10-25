/** Wheeling Miners QR receipt lifecycle. This QR is NOT an admission credential.
 * Admin routes are authenticated by seat-admin.js. Never log or persist plaintext tokens.
 */
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const ORDER=/^[1-9][0-9]{0,19}$/;
const CODE=/^[a-f0-9]{64}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async code=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))));
const newCode=()=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return hex(bytes)};
async function readBody(request,maxBytes=2048){
 const length=Number(request.headers.get('content-length'));
 if(Number.isFinite(length)&&length>maxBytes)return {error:'BODY_TOO_LARGE',status:413};
 let raw;
 try{raw=await request.text()}catch{return {error:'INVALID_BODY',status:400}}
 if(new TextEncoder().encode(raw).byteLength>maxBytes)return {error:'BODY_TOO_LARGE',status:413};
 try{const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return {data}}
 catch{return {error:'INVALID_JSON',status:400}}
}
async function verifiedSeats(env,id){
 const result=await env.SEAT_DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold FROM seats WHERE shopify_order_id=?").bind(id).first();
 return Number(result?.n)>0&&Number(result.n)===Number(result.sold);
}
export async function handleReceiptQrAdmin(request,env){
 const path=new URL(request.url).pathname;
 if(!['/api/seats/admin/receipt-qr-create','/api/seats/admin/receipt-qr-revoke','/api/seats/admin/receipt-qr-resolve'].includes(path))return null;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(!env?.SEAT_DB?.prepare)return json({error:'DATABASE_UNAVAILABLE'},503);
 const body=await readBody(request);if(body.error)return json({error:body.error},body.status);
 const data=body.data;
 if(path.endsWith('-resolve')){
  if(typeof data.code!=='string'||!CODE.test(data.code))return json({error:'INVALID_CODE'},422);
  const digest=await hash(data.code);
  const record=await env.SEAT_DB.prepare('SELECT shopify_order_id FROM seat_receipt_qr WHERE token_hash=? AND revoked_at IS NULL').bind(digest).first();
  if(!record)return json({error:'RECEIPT_NOT_FOUND'},404);
  if(!await verifiedSeats(env,record.shopify_order_id))return json({error:'ORDER_REQUIRES_STAFF_REVIEW'},409);
  return json({ok:true,order_id:record.shopify_order_id});
 }
 const id=data.order_id;
 if(typeof id!=='string'||!ORDER.test(id))return json({error:'INVALID_ORDER_ID'},422);
 if(path.endsWith('-revoke')){
  // Revocation remains possible after refunds or reconciliation problems.
  const outcome=await env.SEAT_DB.prepare('UPDATE seat_receipt_qr SET revoked_at=CURRENT_TIMESTAMP WHERE shopify_order_id=? AND revoked_at IS NULL').bind(id).run();
  return json({ok:true,order_id:id,revoked:Number(outcome.meta?.changes||0)>0});
 }
 if(!await verifiedSeats(env,id))return json({error:'PAID_SEATS_NOT_VERIFIED'},409);
 const code=newCode(),digest=await hash(code);
 // Atomic conditional UPSERT: simultaneous requests cannot replace an active receipt.
 // The code is returned ONLY if this exact statement changed one row.
 const outcome=await env.SEAT_DB.prepare(`INSERT INTO seat_receipt_qr(shopify_order_id,token_hash)
 VALUES(?,?) ON CONFLICT(shopify_order_id) DO UPDATE SET
 token_hash=excluded.token_hash,created_at=CURRENT_TIMESTAMP,revoked_at=NULL
 WHERE seat_receipt_qr.revoked_at IS NOT NULL`).bind(id,digest).run();
 if(Number(outcome.meta?.changes||0)!==1)return json({error:'ACTIVE_QR_EXISTS_REVOKE_BEFORE_REISSUE'},409);
 const receipt_url=new URL('/ticket-receipt.html',request.url);
 receipt_url.hash='code='+code;
 return json({ok:true,order_id:id,receipt_url:receipt_url.toString(),warning:'Private receipt only; not valid for admission. Link shown once.'},201);
}
export async function handleReceiptQrPublic(request,env){
 const path=new URL(request.url).pathname;
 if(path!=='/api/seats/receipt/lookup')return null;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(!env?.SEAT_DB?.prepare)return json({error:'DATABASE_UNAVAILABLE'},503);
 const body=await readBody(request,256);if(body.error)return json({error:body.error},body.status);
 if(typeof body.data.code!=='string'||!CODE.test(body.data.code))return json({error:'INVALID_CODE'},422);
 const digest=await hash(body.data.code);
 const record=await env.SEAT_DB.prepare('SELECT shopify_order_id FROM seat_receipt_qr WHERE token_hash=? AND revoked_at IS NULL').bind(digest).first();
 if(!record)return json({error:'RECEIPT_NOT_FOUND'},404);
 const rows=await env.SEAT_DB.prepare('SELECT section,row_label,seat_number,status FROM seats WHERE shopify_order_id=? ORDER BY section,row_label,seat_number').bind(record.shopify_order_id).all();
 const seats=rows?.results||[];
 if(!seats.length||seats.some(seat=>seat.status!=='SOLD'))return json({error:'ORDER_REQUIRES_STAFF_REVIEW'},409);
 const issued=await env.SEAT_DB.prepare('SELECT issued_at FROM seat_ticket_issuance WHERE shopify_order_id=?').bind(record.shopify_order_id).first();
 return json({ok:true,season_tickets:seats.map(s=>({section:s.section,row:s.row_label,seat:s.seat_number})),ticket_count:seats.length,issuance_status:issued?'ISSUED':'NOT_ISSUED',note:'Receipt only; not valid for admission. Staff must verify identity and proof of purchase.'});
}
