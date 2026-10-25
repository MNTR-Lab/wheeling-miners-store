/** Read-only diagnostic for paid Shopify TEST order #1002. No database writes. */
import fs from 'node:fs';
const token=process.env.CLOUDFLARE_TEST_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Missing Cloudflare test credentials');
const db='2a06b7a7-e833-4a01-8667-2f6388dc0ee0';
const order='18970068058169';
const sku='WM-ST-105-B-02';
const reservation='wm_test_checkout_fb62ced75e991e161aa0c37f';
async function query(sql,params=[]){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({sql,params})});
 const data=await r.json();if(!r.ok||!data.success||!data.result?.[0]?.success)throw Error(`Read-only D1 query failed (${r.status}): ${JSON.stringify(data.errors||data.result?.[0]?.error||'unknown')}`);
 return data.result[0].results||[];
}
const [seats,reservations,linked]=await Promise.all([
 query('SELECT sku,status,hold_id,hold_expires_at,shopify_order_id,shopify_variant_id FROM seats WHERE sku=?',[sku]),
 query('SELECT id,status,expires_at,shopify_order_id,created_at FROM reservations WHERE id=?',[reservation]),
 query('SELECT reservation_id,seat_sku,shopify_variant_id FROM reservation_seats WHERE reservation_id=?',[reservation])
]);
const seat=seats[0],res=reservations[0];
let verdict='REQUIRES_MANUAL_REVIEW';
if(!seat||!res||linked.length!==1||linked[0].seat_sku!==sku)verdict='MISSING_OR_INCONSISTENT_LINKAGE';
else if(seat.status==='SOLD'&&String(seat.shopify_order_id)===order&&res.status==='CONFIRMED'&&String(res.shopify_order_id)===order)verdict='ALREADY_CONFIRMED';
else if(seat.shopify_order_id&&String(seat.shopify_order_id)!==order)verdict='CONFLICTING_ORDER_DO_NOT_MODIFY';
else if(seat.status==='HELD'&&seat.hold_id===reservation&&['HELD','CHECKOUT_PENDING'].includes(res.status))verdict='HELD_REQUIRES_VERIFIED_PAYMENT_RECONCILIATION';
else verdict='STATE_CONFLICT_DO_NOT_MODIFY';
const summary=`## Shopify test order #1002 — read-only D1 diagnostic\n\n- Order ID: ${order}\n- Seat: ${sku}\n- Reservation: ${reservation}\n- Result: **${verdict}**\n- Seat status: ${seat?.status??'MISSING'}\n- Reservation status: ${res?.status??'MISSING'}\n- Seat hold belongs to reservation: ${seat?.hold_id===reservation}\n- Reservation expiration: ${res?.expires_at??'MISSING'}\n- Seat Shopify order ID: ${seat?.shopify_order_id??'none'}\n- Reservation Shopify order ID: ${res?.shopify_order_id??'none'}\n- Linked seat matches: ${linked.length===1&&linked[0].seat_sku===sku}\n\n**No database writes or Shopify requests were made. Production inventory is untouched.**\n\nDo not force an expired reservation to SOLD until Shopify payment, order identity, SKU, variant and checkout nonce are independently verified.\n`;
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
if(verdict==='MISSING_OR_INCONSISTENT_LINKAGE'||verdict==='CONFLICTING_ORDER_DO_NOT_MODIFY'||verdict==='STATE_CONFLICT_DO_NOT_MODIFY')process.exitCode=1;
