import test from 'node:test';
import assert from 'node:assert/strict';
import {planExpiryAudit,inspectExpiredHolds} from '../src/seat-expiry-audit.js';
const now=new Date('2026-10-22T20:00:00Z'),ms=now.valueOf();
test('only SELECT with strict HELD reservation and no Shopify order',()=>{
 const p=planExpiryAudit({now});
 assert.match(p.sql,/^SELECT /);assert.match(p.sql,/r.status='HELD'/);
 assert.match(p.sql,/s.shopify_order_id IS NULL/);assert.match(p.sql,/r.shopify_order_id IS NULL/);
 assert.match(p.sql,/r.expires_at<\?/);assert.deepEqual(p.params,[ms,ms,100]);assert.equal(p.mutations,0);
});
test('returns eligible holds without writing',async()=>{
 const calls=[];
 const db={prepare(sql){calls.push(sql);return {bind(){return this},all:async()=>({results:[{sku:'WM-ST-105-B-06',hold_id:'reservation_123456789',hold_expires_at:ms-1000,reservation_status:'HELD'}]})}}};
 const r=await inspectExpiredHolds(db,{now});assert.equal(r.eligibleForReview,1);assert.equal(r.automaticReleaseEnabled,false);assert.ok(calls.every(s=>s.startsWith('SELECT')));
});
test('rejects checkout pending returned from database',async()=>{
 const db={prepare(){return {bind(){return this},all:async()=>({results:[{sku:'WM-ST-105-B-06',hold_id:'reservation_123456789',hold_expires_at:ms-1000,reservation_status:'CHECKOUT_PENDING'}]})}}};
 await assert.rejects(inspectExpiredHolds(db,{now}),/DATABASE_RESULT_INVALID/);
});
test('rejects expired-audit response with unexpired hold',async()=>{
 const db={prepare(){return {bind(){return this},all:async()=>({results:[{sku:'WM-ST-105-B-06',hold_id:'reservation_123456789',hold_expires_at:ms+1000,reservation_status:'HELD'}]})}}};
 await assert.rejects(inspectExpiredHolds(db,{now}),/DATABASE_RESULT_INVALID/);
});
test('rejects invalid limits',()=>assert.throws(()=>planExpiryAudit({limit:501}),/INVALID_LIMIT/));
test('rejects duplicate rows',async()=>{
 const row={sku:'WM-ST-105-B-06',hold_id:'reservation_123456789',hold_expires_at:ms-1000,reservation_status:'HELD'};
 const db={prepare(){return {bind(){return this},all:async()=>({results:[row,row]})}}};
 await assert.rejects(inspectExpiredHolds(db,{now}),/DATABASE_RESULT_INVALID/);
});
