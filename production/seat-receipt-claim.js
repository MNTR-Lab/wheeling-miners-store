/** Exchange the private reservation key from Shopify confirmation for a pickup QR.
 * No customer lookup, outbound email, or payment. Never exposes an unpaid reservation.
 */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export async function handleReceiptClaim(request,env){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env?.WM_ENVIRONMENT!=='PRODUCTION'||env.SHOPIFY_STORE_DOMAIN!=='186815-4c.myshopify.com')return reply({error:'PRODUCTION_ONLY'},423);
 if(!env.SEAT_DB?.prepare||!env.SHOPIFY_WEBHOOK_SECRET)return reply({error:'RECEIPT_UNAVAILABLE'},503);
 let data;try{const len=request.headers.get('content-length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>512))return reply({error:'INVALID_BODY'},413);const raw=await request.arrayBuffer();if(raw.byteLength>512)return reply({error:'INVALID_BODY'},413);data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return reply({error:'INVALID_BODY'},400)}
 if(!data||Object.keys(data).sort().join(',')!=='key,reservation'||!/^wm_(?:pub|control)_[a-f0-9]{32}$/.test(data.reservation||'')||!/^wm_nonce_[a-f0-9]{32}$/.test(data.key||''))return reply({error:'RECEIPT_NOT_FOUND'},404);
 const db=env.SEAT_DB;
 const reservation=await db.prepare('SELECT id,status,checkout_nonce,shopify_order_id FROM reservations WHERE id=?').bind(data.reservation).first();
 if(!reservation||!equal(reservation.checkout_nonce,data.key))return reply({error:'RECEIPT_NOT_FOUND'},404);
 if(reservation.status!=='CONFIRMED'||!/^\d{1,20}$/.test(String(reservation.shopify_order_id||'')))return reply({error:'PAYMENT_CONFIRMATION_PENDING'},409);
 const orderId=String(reservation.shopify_order_id);
 const linked=await db.prepare('SELECT seat_sku FROM reservation_seats WHERE reservation_id=?').bind(reservation.id).all();
 const seats=await db.prepare('SELECT sku,status FROM seats WHERE shopify_order_id=?').bind(orderId).all();
 const expected=(linked.results||[]).map(s=>s.seat_sku).sort();
 if(!expected.length||expected.length>8||seats.results?.length!==expected.length||seats.results.some(s=>s.status!=='SOLD')||JSON.stringify(seats.results.map(s=>s.sku).sort())!==JSON.stringify(expected))return reply({error:'ORDER_REQUIRES_STAFF_REVIEW'},409);
 const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SHOPIFY_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const code=hex(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode('wm-party-receipt-v1:'+orderId+':'+data.key)));
 const digest=await hash(code);
 // An existing or revoked staff-issued receipt must never be replaced by this link.
 await db.prepare('INSERT INTO seat_receipt_qr(shopify_order_id,token_hash) VALUES(?,?) ON CONFLICT(shopify_order_id) DO NOTHING').bind(orderId,digest).run();
 const record=await db.prepare('SELECT token_hash,revoked_at FROM seat_receipt_qr WHERE shopify_order_id=?').bind(orderId).first();
 if(!record||record.revoked_at!==null||!equal(record.token_hash,digest))return reply({error:'RECEIPT_REQUIRES_TICKET_OFFICE'},409);
 return reply({ok:true,code});
}
