import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAtomicHold,executeAtomicHold} from '../src/seat-hold-transaction.js';
const sku='WM-ST-105-B-06',rid='reservation_123456789',ms=Date.parse('2099-01-01T00:00:00.000Z');
const row={sku,status:'AVAILABLE',hold_id:null,shopify_order_id:null,shopify_variant_id:'gid://shopify/ProductVariant/456',price_cents:16000};
const plan=()=>prepareAtomicHold([sku],[row],{reservationId:rid,expiresAt:ms});
function fake(){const calls=[];return {calls,db:{prepare(sql){const c={sql,params:[]};calls.push(c);return {bind(...p){c.params=p;return this}}},async batch(s){assert.equal(s.length,calls.length)}}}}
test('plans D1 integer expiry',()=>{const p=plan();assert.equal(p.expiresAt,ms);assert.equal(p.operations[0].params[1],ms)});
test('accepts legacy ISO input but normalizes integer',()=>assert.equal(prepareAtomicHold([sku],[row],{reservationId:rid,expiresAt:new Date(ms).toISOString()}).expiresAt,ms));
test('guards each held seat in one batch',async()=>{const f=fake();await executeAtomicHold(f.db,plan(),{authorized:true});assert.equal(f.calls.length,4);assert.equal(f.calls[1].params[1],ms)});
test('authorization required before SQL',async()=>{const f=fake();await assert.rejects(executeAtomicHold(f.db,plan()),/NOT_AUTHORIZED/);assert.equal(f.calls.length,0)});
test('tampered SKU rejected before SQL',async()=>{const f=fake(),p=plan();p.operations[0].params[2]='WM-ST-105-B-07';await assert.rejects(executeAtomicHold(f.db,p,{authorized:true}),/UNTRUSTED_PLAN/);assert.equal(f.calls.length,0)});
test('tampered expiry rejected before SQL',async()=>{const f=fake(),p=plan();p.operations[0].params[1]=ms+1000;await assert.rejects(executeAtomicHold(f.db,p,{authorized:true}),/UNTRUSTED_PLAN/);assert.equal(f.calls.length,0)});
test('expired hold rejected before SQL',async()=>{const f=fake();await assert.rejects(executeAtomicHold(f.db,plan(),{authorized:true,now:new Date('2100-01-01')}),/INVALID_EXPIRATION/);assert.equal(f.calls.length,0)});
test('unreleased seat rejected',()=>assert.throws(()=>prepareAtomicHold([sku],[{...row,status:'UNRELEASED'}],{reservationId:rid,expiresAt:ms}),/SEATS_NOT_AVAILABLE/));
