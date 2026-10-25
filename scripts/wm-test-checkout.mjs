import crypto from 'node:crypto';
const required=['CLOUDFLARE_TEST_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','WM_TEST_SEAT_ADMIN_TOKEN'];
for(const name of required)if(!process.env[name])throw Error(`Missing ${name}`);
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const database='2a06b7a7-e833-4a01-8667-2f6388dc0ee0'; // TEST D1 ONLY
const base='https://wheeling-miners-store-test.bikard.workers.dev';
const sku='WM-ST-105-B-02';
const variant='gid://shopify/ProductVariant/50943009259577';
const headers={Authorization:`Bearer ${process.env.CLOUDFLARE_TEST_API_TOKEN}`,'content-type':'application/json'};
async function query(sql,params=[]){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers,body:JSON.stringify({sql,params})});
 const j=await r.json();if(!r.ok||!j.success||!j.result?.[0]?.success)throw Error(`Test D1 query failed: ${JSON.stringify(j.errors??j.result?.[0]?.error??r.status)}`);
 return j.result[0];
}
const seat=(await query('SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku=?',[sku])).results?.[0];
if(!seat||seat.status!=='UNRELEASED'||seat.hold_id!==null||seat.shopify_order_id!==null||seat.shopify_variant_id!==variant||seat.price_cents!==100)throw Error('Test seat is not in its approved clean state; stopping without changes.');
const id='wm_test_checkout_'+crypto.randomBytes(12).toString('hex');
const nonce='wm_nonce_'+crypto.randomBytes(24).toString('hex');
const now=Date.now(), expiry=now+30*60*1000;
// Inserts are limited to the hard-coded test database and SKU. A fresh reservation is generated each run.
await query('INSERT INTO reservations (id,status,created_at,checkout_nonce,expires_at,shopify_order_id) VALUES (?,\'HELD\',?,?,?,NULL)',[id,now,nonce,expiry]);
await query('INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id) VALUES (?,?,?)',[id,sku,variant]);
const changed=await query("UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='UNRELEASED' AND hold_id IS NULL AND shopify_order_id IS NULL AND shopify_variant_id=?",[id,expiry,sku,variant]);
if(changed.meta?.changes!==1)throw Error('Test seat could not be exclusively held; no cart was created.');
const response=await fetch(`${base}/api/seats/admin/controlled-cart`,{method:'POST',headers:{authorization:`Bearer ${process.env.WM_TEST_SEAT_ADMIN_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({reservationId:id})});
const body=await response.json().catch(()=>({error:'NON_JSON_RESPONSE'}));
if(!response.ok||body.mode!=='CONTROLLED_CART_ONLY')throw Error(`Test cart failed (${response.status}): ${body.error??'UNEXPECTED_RESPONSE'}. Reservation ${id} expires in 30 minutes; no purchase was made.`);
if(typeof body.checkoutUrl!=='string'||!body.checkoutUrl.startsWith('https://wheeling-miners-ticket-testing.myshopify.com/'))throw Error('Unexpected checkout host; refusing to expose URL.');
const summary=process.env.GITHUB_STEP_SUMMARY;
if(summary){const fs=await import('node:fs');fs.appendFileSync(summary,`## Isolated test checkout ready\n\n- Seat: ${sku}\n- Test reservation: ${id}\n- Expires: ${new Date(expiry).toISOString()}\n- **Test-store checkout:** ${body.checkoutUrl}\n\n**Only use Shopify test payment. Do not enter a real card or use GOAT Sports production.**\n`);}
console.log('Controlled test cart created. Open the workflow run summary for the test-only checkout URL. No payment processed.');
