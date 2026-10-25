/** Read-only Shopify payment + D1 ownership verification. TEST store and TEST D1 only. */
import fs from 'node:fs';
const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const DB='2a06b7a7-e833-4a01-8667-2f6388dc0ee0';
const ORDER='18970068058169';
const SKU='WM-ST-105-B-02';
const RID='wm_test_checkout_fb62ced75e991e161aa0c37f';
const VARIANT='50943009259577';
const vars=['CLOUDFLARE_TEST_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','WM_SHOPIFY_CLIENT_ID','WM_SHOPIFY_CLIENT_SECRET'];
for(const key of vars)if(!process.env[key])throw Error('MISSING_REQUIRED_SECRET_'+key);
const safe=(v)=>String(v??'').replace(/[\r\n|]/g,' ').slice(0,180);
const report=[];
const add=(k,v)=>report.push(`- ${k}: ${safe(v)}`);
const fail=(code)=>{add('Verdict',code);throw Error(code)};
const cf=async(sql,params=[])=>{
 if(!/^\s*SELECT\b/i.test(sql))throw Error('READ_ONLY_SQL_REQUIRED');
 const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB}/query`,{method:'POST',headers:{authorization:`Bearer ${process.env.CLOUDFLARE_TEST_API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({sql,params})});
 const data=await res.json();if(!res.ok||!data.success||!data.result?.[0]?.success)throw Error('TEST_D1_READ_FAILED');
 return data.result[0].results??[];
};
let verdict='NOT_VERIFIED';
try{
 const tokenResponse=await fetch(`https://${SHOP}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.WM_SHOPIFY_CLIENT_ID,client_secret:process.env.WM_SHOPIFY_CLIENT_SECRET})});
 if(!tokenResponse.ok)fail('SHOPIFY_TOKEN_EXCHANGE_FAILED');
 const token=await tokenResponse.json();if(!token.access_token)fail('SHOPIFY_TOKEN_MISSING');
 const scopes=(token.scope??'').split(',').map(x=>x.trim());
 if(!scopes.includes('read_orders')&&!scopes.includes('read_all_orders'))fail('SHOPIFY_READ_ORDERS_SCOPE_REQUIRED');
 const gql=`query VerifyTestOrder($id: ID!) { order(id: $id) { id name displayFinancialStatus cancelledAt createdAt processedAt noteAttributes { name value } lineItems(first: 20) { nodes { sku quantity variant { id } } } } }`;
 const response=await fetch(`https://${SHOP}/admin/api/2026-10/graphql.json`,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token.access_token},body:JSON.stringify({query:gql,variables:{id:`gid://shopify/Order/${ORDER}`}})});
 if(!response.ok)fail('SHOPIFY_ORDER_QUERY_HTTP_'+response.status);
 const body=await response.json();if(body.errors?.length)fail('SHOPIFY_ORDER_QUERY_DENIED');
 const order=body.data?.order;if(!order)fail('SHOPIFY_ORDER_NOT_FOUND');
 add('Shopify order',order.name);add('Financial status',order.displayFinancialStatus);add('Cancelled',Boolean(order.cancelledAt));
 const attrs=new Map();for(const x of order.noteAttributes??[]){if(attrs.has(x.name))fail('DUPLICATE_NOTE_ATTRIBUTE');attrs.set(x.name,x.value)}
 const lines=order.lineItems?.nodes??[];const matches=lines.filter(x=>x.sku===SKU);
 if(order.id!==`gid://shopify/Order/${ORDER}`||order.cancelledAt||order.displayFinancialStatus!=='PAID'||matches.length!==1||matches[0].quantity!==1||matches[0].variant?.id!==`gid://shopify/ProductVariant/${VARIANT}`||attrs.get('wm_reservation_id')!==RID)fail('SHOPIFY_PAYMENT_OR_SEAT_MISMATCH');
 const [seatRows,resRows,links]=await Promise.all([
  cf('SELECT sku,status,hold_id,hold_expires_at,shopify_order_id,shopify_variant_id FROM seats WHERE sku=?',[SKU]),
  cf('SELECT id,status,checkout_nonce,expires_at,shopify_order_id FROM reservations WHERE id=?',[RID]),
  cf('SELECT reservation_id,seat_sku,shopify_variant_id FROM reservation_seats WHERE reservation_id=?',[RID])
 ]);
 const seat=seatRows[0],res=resRows[0];
 if(!seat||!res||links.length!==1||links[0].seat_sku!==SKU||links[0].shopify_variant_id!==`gid://shopify/ProductVariant/${VARIANT}`||seat.shopify_variant_id!==links[0].shopify_variant_id||seat.hold_id!==RID||seat.status!=='HELD'||res.status!=='HELD'||seat.shopify_order_id!==null||res.shopify_order_id!==null||!res.checkout_nonce||attrs.get('wm_checkout_nonce')!==res.checkout_nonce)fail('DATABASE_RESERVATION_OR_NONCE_MISMATCH');
 add('Shopify payment and order', 'VERIFIED');add('Shopify seat SKU and variant','VERIFIED');add('Checkout reservation and nonce','VERIFIED');
 add('Seat ownership','VERIFIED HELD');add('Reservation expiration (UTC)',new Date(Number(res.expires_at)).toISOString());
 verdict='VERIFIED_PAID_ORDER_REQUIRES_EXPIRED_HOLD_RECONCILIATION';
 add('Verdict',verdict);
}catch(e){if(verdict!=='VERIFIED_PAID_ORDER_REQUIRES_EXPIRED_HOLD_RECONCILIATION'){verdict='FAILED_CLOSED';add('Error code',e.message);process.exitCode=1}}
finally{
 const summary=`## Order #1002 — Shopify + TEST D1 read-only verification\n\n${report.join('\n')}\n\n**No orders, payments, seats, reservations, or production data were changed.**\n`;
 console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
}
