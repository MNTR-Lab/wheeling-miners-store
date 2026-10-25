/** Production handler with mocked Shopify and real isolated SQLite transactions.
 * No external network, production database, or real payment is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleShopifyPaidWebhook} from '../src/seat-shopify-webhook.js';
const SHOP='186815-4c.myshopify.com',SECRET='offline-production-signing-secret';
const RID='wm_pub_12345678901234567890123456789012',NONCE='wm_nonce_12345678901234567890123456789012';
const SKUS=['WM-ST-105-B-01','WM-ST-105-B-02'];
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
 const statement=(sql,params=[])=>({sql,params,bind:(...p)=>statement(sql,p),async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}}});
 const db={prepare:sql=>statement(sql),async batch(statements){f.batchCalls++;if(f.beforeBatch)f.beforeBatch();sqlite.exec('BEGIN');try{for(const s of statements)sqlite.prepare(s.sql).run(...s.params);sqlite.exec('COMMIT');f.commits++;return []}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 f.env={WM_ENVIRONMENT:'PRODUCTION',SHOPIFY_STORE_DOMAIN:SHOP,SHOPIFY_CLIENT_ID:'mock-client',SHOPIFY_CLIENT_SECRET:'mock-secret',SHOPIFY_WEBHOOK_SECRET:SECRET,SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true',SEAT_DB:db};
 f.order=(id='123')=>({id,line_items:SKUS.map((sku,i)=>({sku,variant_id:456+i,quantity:1})),note_attributes:[{name:'wm_reservation_id',value:RID},{name:'wm_checkout_nonce',value:NONCE}]});
 f.request=(order=f.order(),shop=SHOP)=>{const body=JSON.stringify(order);return new Request('https://offline.invalid/api/seats/webhooks/shopify',{method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-shop-domain':shop,'x-shopify-hmac-sha256':createHmac('sha256',SECRET).update(body).digest('base64')},body})};
 f.fetch=async url=>{f.fetchCalls++;const u=new URL(url);assert.equal(u.hostname,SHOP);const json=value=>new Response(JSON.stringify(value));if(u.pathname==='/admin/oauth/access_token')return json({access_token:'mock-token',scope:'read_orders'});const id=u.pathname.match(/\/orders\/(\d+)/)?.[1];assert.ok(id,'Unexpected mock Shopify URL');if(u.pathname.endsWith('/transactions.json'))return json({transactions:[{kind:'sale',status:'success',processed_at:f.paidAt}]});return json({order:{id,financial_status:'paid'}})};
 f.send=(order=f.order(),env=f.env,shop=SHOP)=>handleShopifyPaidWebhook(f.request(order,shop),env,{fetchImpl:f.fetch});
 f.seats=()=>sqlite.prepare('SELECT * FROM seats ORDER BY sku').all();
 f.reservation=()=>sqlite.prepare('SELECT * FROM reservations').get();
 f.expire=()=>sqlite.prepare('UPDATE reservations SET expires_at=?').run(now-60000);
 return f;
}
test('production two-seat commit and duplicate delivery are idempotent in SQLite',async t=>{const f=fixture(t);const first=await f.send();assert.equal(first.status,200);assert.equal((await first.json()).seat_count,2);assert.ok(f.seats().every(s=>s.status==='SOLD'&&s.shopify_order_id==='123'&&s.hold_id===null));assert.equal(f.reservation().status,'CONFIRMED');const again=await f.send();assert.equal(again.status,200);assert.equal((await again.json()).replayed,true);assert.equal(f.batchCalls,1);assert.equal(f.commits,1)});
for(const flag of ['SEAT_PAID_FULFILLMENT_ENABLED','SEAT_PUBLIC_SALES_APPROVED','SEAT_PRODUCTION_PAID_COMMIT_APPROVED'])test('production cannot write without '+flag,async t=>{const f=fixture(t);delete f.env[flag];assert.equal((await f.send()).status,503);assert.equal(f.batchCalls,0);assert.equal(f.fetchCalls,0);assert.ok(f.seats().every(s=>s.status==='HELD'))});
test('production refuses TEST and unrelated shop headers before verification or writes',async t=>{const f=fixture(t);for(const shop of ['wheeling-miners-ticket-testing.myshopify.com','unrelated.myshopify.com'])assert.equal((await f.send(f.order(),f.env,shop)).status,403);assert.equal(f.fetchCalls,0);assert.equal(f.batchCalls,0)});
test('invalid production HMAC cannot reach Shopify or database writes',async t=>{const f=fixture(t);const request=f.request();request.headers.set('x-shopify-hmac-sha256','invalid');assert.equal((await handleShopifyPaidWebhook(request,f.env,{fetchImpl:f.fetch})).status,401);assert.equal(f.fetchCalls,0);assert.equal(f.batchCalls,0)});
test('late verified payment rejects even when payload claims an earlier time',async t=>{const f=fixture(t);f.expire();const order={...f.order(),paid_at:new Date(f.now-120000).toISOString()};assert.equal((await f.send(order)).status,503);assert.equal(f.batchCalls,0);assert.ok(f.seats().every(s=>s.status==='HELD'))});
test('delayed webhook accepts verified in-window payment with unchanged ownership',async t=>{const f=fixture(t);f.expire();f.paidAt=new Date(f.now-120000).toISOString();assert.equal((await f.send()).status,200);assert.equal(f.commits,1);assert.ok(f.seats().every(s=>s.status==='SOLD'))});
test('payment predating expired reservation never commits',async t=>{const f=fixture(t);f.expire();f.paidAt=new Date(f.now-1800000).toISOString();assert.equal((await f.send()).status,503);assert.equal(f.batchCalls,0)});
test('another verified paid order cannot overwrite confirmed seat ownership',async t=>{const f=fixture(t);assert.equal((await f.send()).status,200);assert.equal((await f.send(f.order('124'))).status,503);assert.equal(f.batchCalls,1);assert.ok(f.seats().every(s=>s.shopify_order_id==='123'))});
test('delayed paid webhook cannot reclaim a seat released to another reservation',async t=>{const f=fixture(t);f.expire();f.paidAt=new Date(f.now-120000).toISOString();f.sqlite.prepare('UPDATE seats SET hold_id=? WHERE sku=?').run('another_reservation_123456',SKUS[1]);assert.equal((await f.send()).status,503);assert.equal(f.batchCalls,0);assert.equal(f.seats()[1].hold_id,'another_reservation_123456')});
test('competing hold after reads rolls back every seat update in real SQLite',async t=>{const f=fixture(t);f.beforeBatch=()=>f.sqlite.prepare('UPDATE seats SET hold_id=? WHERE sku=?').run('racing_reservation_123456',SKUS[1]);assert.equal((await f.send()).status,503);assert.equal(f.batchCalls,1);assert.equal(f.commits,0);assert.ok(f.seats().every(s=>s.status==='HELD'&&s.shopify_order_id===null));assert.equal(f.seats()[1].hold_id,'racing_reservation_123456');assert.equal(f.reservation().status,'CHECKOUT_PENDING')});
test('reservation conflict after seat reads rolls back both seat updates',async t=>{const f=fixture(t);f.beforeBatch=()=>f.sqlite.prepare("UPDATE reservations SET status='CANCELLED'").run();assert.equal((await f.send()).status,503);assert.equal(f.commits,0);assert.ok(f.seats().every(s=>s.status==='HELD'&&s.shopify_order_id===null));assert.equal(f.reservation().status,'CANCELLED')});
test('missing read_orders scope fails closed before database batch',async t=>{const f=fixture(t);f.fetch=async()=>new Response(JSON.stringify({access_token:'mock-token',scope:'read_products'}));assert.equal((await f.send()).status,503);assert.equal(f.batchCalls,0)});
