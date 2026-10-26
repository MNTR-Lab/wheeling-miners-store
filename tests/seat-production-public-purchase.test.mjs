/** Production handler with mocked Shopify and real isolated SQLite transactions.
 * No external network, production database, or real payment is used.
 */
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {handlePublicCheckout} from '../production/seat-public-checkout.js';
import {handleReceiptClaim} from '../production/seat-receipt-claim.js';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import productionWorker,{handleControlledProductionWebhook as handleShopifyPaidWebhook,controlledTestConfig,handleControlledReservation} from '../production/worker.js';
const SHOP='186815-4c.myshopify.com',SECRET='offline-production-signing-secret';
const RID='wm_control_12345678901234567890123456789012',NONCE='wm_nonce_12345678901234567890123456789012';
const SKUS=['WM-ST-105-B-01'];
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec(`CREATE TABLE reservations(id TEXT PRIMARY KEY,status TEXT,checkout_nonce TEXT,shopify_order_id TEXT,expires_at INTEGER,created_at INTEGER);
 CREATE TABLE seats(sku TEXT PRIMARY KEY,status TEXT,shopify_variant_id TEXT,shopify_order_id TEXT,hold_id TEXT,hold_expires_at INTEGER,updated_at TEXT);
 CREATE TABLE reservation_seats(reservation_id TEXT,seat_sku TEXT,shopify_variant_id TEXT);
 CREATE TABLE seat_admin_guard(id INTEGER PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));`);
 const now=Date.now();
 sqlite.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?)').run(RID,'CHECKOUT_PENDING',NONCE,null,now+900000,now-900000);
 SKUS.forEach((sku,i)=>{const variant=`gid://shopify/ProductVariant/${456+i}`;sqlite.prepare('INSERT INTO seats VALUES(?,?,?,?,?,?,?)').run(sku,'HELD',variant,null,RID,now+900000,null);sqlite.prepare('INSERT INTO reservation_seats VALUES(?,?,?)').run(RID,sku,variant)});
 const f={sqlite,now,paidAt:new Date(now).toISOString(),batchCalls:0,commits:0,fetchCalls:0,beforeBatch:null};
 const statement=(sql,params=[])=>({sql,params,bind:(...p)=>statement(sql,p),async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}}}});
 const db={prepare:sql=>statement(sql),async batch(statements){f.batchCalls++;if(f.beforeBatch)f.beforeBatch();sqlite.exec('BEGIN');try{for(const s of statements)sqlite.prepare(s.sql).run(...s.params);sqlite.exec('COMMIT');f.commits++;return []}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 f.env={SEAT_ADMIN_TOKEN:'offline-admin-token-12345678901234567890',WM_ENVIRONMENT:'PRODUCTION',SHOPIFY_STORE_DOMAIN:SHOP,SHOPIFY_CLIENT_ID:'mock-client',SHOPIFY_CLIENT_SECRET:'mock-secret',SHOPIFY_WEBHOOK_SECRET:SECRET,SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED:'true',SEAT_PRODUCTION_CONTROLLED_TEST_APPROVED:'true',SEAT_PRODUCTION_CONTROLLED_SKU:SKUS[0],SEAT_PRODUCTION_CONTROLLED_RESERVATION_ID:RID,SEAT_PRODUCTION_CONTROLLED_PRICE_CENTS:'6500',SEAT_PRODUCTION_CONTROLLED_TEST_UNTIL:new Date(now+1800000).toISOString(),SEAT_DB:db};
 f.order=(id='123')=>({id,line_items:SKUS.map((sku,i)=>({sku,variant_id:456+i,quantity:1})),note_attributes:[{name:'wm_reservation_id',value:RID},{name:'wm_checkout_nonce',value:NONCE}]});
 f.request=(order=f.order(),shop=SHOP)=>{const body=JSON.stringify(order);return new Request('https://offline.invalid/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-shop-domain':shop,'x-shopify-hmac-sha256':createHmac('sha256',SECRET).update(body).digest('base64')},body})};
 f.fetch=async url=>{f.fetchCalls++;const u=new URL(url);assert.equal(u.hostname,SHOP);const json=value=>new Response(JSON.stringify(value));if(u.pathname==='/admin/oauth/access_token')return json({access_token:'mock-token',scope:'read_orders'});const id=u.pathname.match(/\/orders\/(\d+)/)?.[1];assert.ok(id,'Unexpected mock Shopify URL');if(u.pathname.endsWith('/transactions.json'))return json({transactions:[{kind:'sale',status:'success',processed_at:f.paidAt}]});return json({order:{id,financial_status:'paid'}})};
 f.send=(order=f.order(),env=f.env,shop=SHOP)=>handleShopifyPaidWebhook(f.request(order,shop),env,{fetchImpl:f.fetch});
 f.seats=()=>sqlite.prepare('SELECT * FROM seats ORDER BY sku').all();
 f.reservation=()=>sqlite.prepare('SELECT * FROM reservations').get();
 f.expire=()=>sqlite.prepare('UPDATE reservations SET expires_at=?').run(now-60000);
 return f;
}


test('public hold to custom-domain checkout to verified paid webhook to pickup QR without a real charge',async t=>{
 const f=fixture(t);f.sqlite.exec('ALTER TABLE seats ADD COLUMN price_cents INTEGER');
 f.sqlite.prepare("UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,price_cents=6500").run();
 for(const path of ['001-seat-ticket-issuance.sql','002-seat-receipt-qr.sql'])f.sqlite.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'));
 const env={...f.env,SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED:'false',SEAT_PRODUCTION_CONTROLLED_TEST_APPROVED:'false',SEAT_PUBLIC_SALES_ENABLED:'true',SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_CONTROLLED_CART_ENABLED:'true',SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true',SHOPIFY_STOREFRONT_TOKEN:'offline-storefront-token'};
 const req=(path,body)=>new Request('https://offline.invalid'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const options={now:()=>new Date(f.now),randomUUID:()=> 'abcdef1234567890abcdef1234567890'};
 const hold=await handlePublicCheckout(req('/api/seats/hold',{skus:SKUS}),env,options);assert.equal(hold.status,201);const held=await hold.json();
 let attributes;
 const checkout=await handlePublicCheckout(req('/api/seats/checkout',{reservationId:held.reservationId}),env,{...options,fetchImpl:async(url,init)=>{
  assert.equal(new URL(url).hostname,SHOP);const input=JSON.parse(init.body).variables.input;attributes=input.attributes;
  return new Response(JSON.stringify({data:{cartCreate:{cart:{id:'gid://shopify/Cart/offline',checkoutUrl:'https://www.begoativated.com/cart/c/offline',attributes:input.attributes,lines:{nodes:input.lines.map(line=>({quantity:line.quantity,merchandise:{id:line.merchandiseId}}))}},userErrors:[]}}}));
 }});assert.equal(checkout.status,200);assert.equal((await checkout.json()).checkoutUrl,'https://www.begoativated.com/cart/c/offline');
 const privateLink=new URL(attributes.find(x=>x.key==='wm_pickup_receipt_url').value);assert.equal(privateLink.origin,'https://wheeling-miners-store.bikard.workers.dev');const params=new URLSearchParams(privateLink.hash.slice(1));
 const claimRequest=()=>req('/api/seats/receipt/claim',{reservation:params.get('reservation'),key:params.get('key')});
 assert.equal((await handleReceiptClaim(claimRequest(),env)).status,409);
 const order=f.order();order.note_attributes=attributes.map(a=>({name:a.key,value:a.value}));
 const paid=await handleShopifyPaidWebhook(f.request(order),env,{fetchImpl:f.fetch});assert.equal(paid.status,200);assert.equal(f.seats()[0].status,'SOLD');
 const replay=await handleShopifyPaidWebhook(f.request(order),env,{fetchImpl:f.fetch});assert.equal((await replay.json()).replayed,true);
 const receipt=await handleReceiptClaim(claimRequest(),env);assert.equal(receipt.status,200);assert.match((await receipt.json()).code,/^[a-f0-9]{64}$/);
});
