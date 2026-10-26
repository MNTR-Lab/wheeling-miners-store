/** Offline receipt lifecycle using the actual migrations and isolated SQLite. No payment/network. */
import test from 'node:test';
import {releaseExpiredPublicHolds} from '../production/seat-expired-holds.js';
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


test('expired public hold releases after grace; current, paid, and controlled holds do not',async t=>{
 const f=fixture(t);const now=Date.now(),cutoff=now-900000;f.sqlite.exec('ALTER TABLE reservations ADD COLUMN expires_at INTEGER; ALTER TABLE seats ADD COLUMN hold_id TEXT; ALTER TABLE seats ADD COLUMN hold_expires_at INTEGER; ALTER TABLE seats ADD COLUMN updated_at TEXT');
 f.sqlite.prepare('INSERT INTO reservations(id,status,checkout_nonce,shopify_order_id,expires_at) VALUES(?,?,?,?,?)').run('wm_pub_expired','HELD','offline',null,cutoff-1);
 f.sqlite.prepare("UPDATE seats SET status='HELD',shopify_order_id=NULL,hold_id='wm_pub_expired',hold_expires_at=?").run(cutoff-1);
 const env={...f.env,SEAT_PUBLIC_SALES_ENABLED:'true',SEAT_PUBLIC_SALES_APPROVED:'true',SEAT_CONTROLLED_CART_ENABLED:'true',SEAT_PAID_FULFILLMENT_ENABLED:'true',SEAT_PRODUCTION_PAID_COMMIT_APPROVED:'true',SHOPIFY_CLIENT_ID:'mock',SHOPIFY_CLIENT_SECRET:'mock',SHOPIFY_STOREFRONT_TOKEN:'mock-storefront-token'};
 await releaseExpiredPublicHolds(env,{now});assert.equal(f.sqlite.prepare('SELECT status FROM seats').get().status,'AVAILABLE');assert.equal(f.sqlite.prepare('SELECT status FROM reservations').get().status,'EXPIRED');
 for(const [id,status,expiry,order] of [['wm_pub_current','HELD',now+1000,null],['wm_pub_grace','HELD',now-1000,null],['wm_pub_paid','CONFIRMED',cutoff-1,'123'],['wm_control_old','HELD',cutoff-1,null]]){
  f.sqlite.prepare('INSERT INTO reservations VALUES(?,?,?,?,?)').run(id,status,'offline',order,expiry);
  f.sqlite.prepare("UPDATE seats SET status=?,shopify_order_id=?,hold_id=?,hold_expires_at=?").run(order?'SOLD':'HELD',order,id,expiry);
  await releaseExpiredPublicHolds(env,{now});assert.equal(f.sqlite.prepare('SELECT status FROM seats').get().status,order?'SOLD':'HELD');
 }
});
test('closed sales or TEST environment cannot reclaim holds',async()=>{for(const env of [{},{WM_ENVIRONMENT:'TEST'}]){env.SEAT_DB={get batch(){throw Error('No writes allowed')}};assert.deepEqual(await releaseExpiredPublicHolds(env),{enabled:false})}});
