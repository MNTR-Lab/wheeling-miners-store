/** Offline receipt lifecycle using the actual migrations and isolated SQLite. No payment/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleReceiptQrAdmin,handleReceiptQrPublic} from '../src/seat-receipt-qr.js';
import {handleReceiptVerification} from '../src/seat-receipt-verification.js';
import production from '../production/worker.js';
import {handleReceiptClaim} from '../production/seat-receipt-claim.js';
function fixture(t,status='SOLD'){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec('CREATE TABLE seats(sku TEXT PRIMARY KEY,section TEXT,row_label TEXT,seat_number INTEGER,price_cents INTEGER,status TEXT,shopify_order_id TEXT)');
 for(const path of ['001-seat-ticket-issuance.sql','002-seat-receipt-qr.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO seats VALUES(?,?,?,?,?,?,?)').run('WM-ST-301-L2-01','301','L2',1,6500,status,'123');
 const stmt=(sql,params=[])=>({sql,params,bind:(...p)=>stmt(sql,p),async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}}}});
 sqlite.exec("CREATE TABLE reservations(id TEXT PRIMARY KEY,status TEXT,checkout_nonce TEXT,shopify_order_id TEXT);CREATE TABLE reservation_seats(reservation_id TEXT,seat_sku TEXT);");
 const env={WM_ENVIRONMENT:'PRODUCTION',SHOPIFY_STORE_DOMAIN:'186815-4c.myshopify.com',SHOPIFY_WEBHOOK_SECRET:'offline-receipt-signing-secret',SEAT_ADMIN_TOKEN:'offline-admin-token-12345678901234567890',SEAT_DB:{prepare:sql=>stmt(sql),async batch(items){sqlite.exec('BEGIN');try{const results=items.map(x=>sqlite.prepare(x.sql).run(...x.params));sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}}};
 const req=(path,body)=>new Request('https://offline.invalid'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {sqlite,env,req,create:()=>handleReceiptQrAdmin(req('/api/seats/admin/receipt-qr-create',{order_id:'123'}),env)};
}

const rid='wm_pub_12345678901234567890123456789012',key='wm_nonce_12345678901234567890123456789012';
function paidFixture(t,status='CONFIRMED',seatStatus='SOLD'){const f=fixture(t,seatStatus);f.sqlite.prepare('INSERT INTO reservations VALUES(?,?,?,?)').run(rid,status,key,status==='CONFIRMED'?'123':null);f.sqlite.prepare('INSERT INTO reservation_seats VALUES(?,?)').run(rid,'WM-ST-301-L2-01');f.claim=(body={reservation:rid,key})=>handleReceiptClaim(f.req('/api/seats/receipt/claim',body),f.env);return f}
test('paid reservation link creates stable hashed pickup QR and public lookup',async t=>{const f=paidFixture(t);const first=await f.claim();assert.equal(first.status,200);const d=await first.json();assert.match(d.code,/^[a-f0-9]{64}$/);assert.notEqual(f.sqlite.prepare('SELECT token_hash FROM seat_receipt_qr').get().token_hash,d.code);assert.deepEqual(await (await f.claim()).json(),d);const receipt=await handleReceiptQrPublic(f.req('/api/seats/receipt/lookup',{code:d.code}),f.env);assert.equal(receipt.status,200);assert.equal((await receipt.json()).ticket_count,1)});
test('unpaid reservation creates no receipt',async t=>{const f=paidFixture(t,'HELD','HELD');assert.equal((await f.claim()).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_receipt_qr').get().n,0)});
test('wrong private key creates no receipt and discloses no order',async t=>{const f=paidFixture(t);assert.equal((await f.claim({reservation:rid,key:'wm_nonce_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})).status,404);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_receipt_qr').get().n,0)});
test('revoked receipt cannot be recreated from original confirmation link',async t=>{const f=paidFixture(t);assert.equal((await f.claim()).status,200);await handleReceiptQrAdmin(f.req('/api/seats/admin/receipt-qr-revoke',{order_id:'123'}),f.env);assert.equal((await f.claim()).status,409)});
test('manual staff replacement cannot be overwritten by confirmation link',async t=>{const f=paidFixture(t);const manual=await f.create();assert.equal(manual.status,201);assert.equal((await f.claim()).status,409)});
test('mismatched or non-SOLD seats fail closed',async t=>{const f=paidFixture(t,'CONFIRMED','HELD');assert.equal((await f.claim()).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_receipt_qr').get().n,0)});
test('claim rejects TEST environment and oversized input',async t=>{const f=paidFixture(t);assert.equal((await handleReceiptClaim(f.req('/api/seats/receipt/claim',{reservation:rid,key}),{...f.env,WM_ENVIRONMENT:'TEST'})).status,423);assert.equal((await f.claim({reservation:rid,key,padding:'x'.repeat(600)})).status,413)});
