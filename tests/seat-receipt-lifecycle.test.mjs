/** Offline receipt lifecycle using the actual migrations and isolated SQLite. No payment/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleReceiptQrAdmin,handleReceiptQrPublic} from '../src/seat-receipt-qr.js';
import {handleReceiptVerification} from '../src/seat-receipt-verification.js';
import production from '../production/worker.js';
function fixture(t,status='SOLD'){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec('CREATE TABLE seats(sku TEXT PRIMARY KEY,section TEXT,row_label TEXT,seat_number INTEGER,price_cents INTEGER,status TEXT,shopify_order_id TEXT)');
 for(const path of ['001-seat-ticket-issuance.sql','002-seat-receipt-qr.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO seats VALUES(?,?,?,?,?,?,?)').run('WM-ST-301-L2-01','301','L2',1,6500,status,'123');
 const stmt=(sql,params=[])=>({sql,params,bind:(...p)=>stmt(sql,p),async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}}}});
 const env={SEAT_ADMIN_TOKEN:'offline-admin-token-12345678901234567890',SEAT_DB:{prepare:sql=>stmt(sql),async batch(items){sqlite.exec('BEGIN');try{const results=items.map(x=>sqlite.prepare(x.sql).run(...x.params));sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}}};
 const req=(path,body)=>new Request('https://offline.invalid'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {sqlite,env,req,create:()=>handleReceiptQrAdmin(req('/api/seats/admin/receipt-qr-create',{order_id:'123'}),env)};
}
test('unpaid seat cannot receive a QR receipt',async t=>{const f=fixture(t,'HELD');assert.equal((await f.create()).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_receipt_qr').get().n,0)});
test('receipt stores a hash, verifies exact seat, refuses duplicate, and revokes',async t=>{const f=fixture(t);const created=await f.create();assert.equal(created.status,201);const d=await created.json();const code=new URL(d.receipt_url).hash.slice(6);const stored=f.sqlite.prepare('SELECT token_hash FROM seat_receipt_qr').get().token_hash;assert.notEqual(stored,code);assert.equal((await f.create()).status,409);let response=await handleReceiptQrPublic(f.req('/api/seats/receipt/lookup',{code}),f.env);assert.equal(response.status,200);const receipt=await response.json();assert.deepEqual(receipt.season_tickets,[{section:'301',row:'L2',seat:1}]);assert.equal(receipt.issuance_status,'NOT_ISSUED');assert.equal(receipt.order_id,undefined);await handleReceiptQrAdmin(f.req('/api/seats/admin/receipt-qr-revoke',{order_id:'123'}),f.env);assert.equal((await handleReceiptQrPublic(f.req('/api/seats/receipt/lookup',{code}),f.env)).status,404);assert.equal((await f.create()).status,201)});
test('ticket collection records once and duplicate issue creates no second audit',async t=>{const f=fixture(t);const body={order_id:'123',operator:'Offline Tester',confirmation:'ISSUE TICKETS 123'};const issue=()=>handleReceiptVerification(f.req('/api/seats/admin/receipt-issue',body),f.env);assert.equal((await issue()).status,201);assert.equal((await issue()).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_ticket_issuance_audit').get().n,1)});
test('production receipt creation rejects missing staff authentication',async t=>{const f=fixture(t);const response=await production.fetch(f.req('/api/seats/admin/receipt-qr-create',{order_id:'123'}),f.env,{});assert.equal(response.status,401);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM seat_receipt_qr').get().n,0)});
