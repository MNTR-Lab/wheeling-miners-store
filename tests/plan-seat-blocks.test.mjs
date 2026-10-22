import test from 'node:test';
import assert from 'node:assert/strict';
import {planSeatBlocks} from '../tools/plan-seat-blocks.mjs';
const args={skus:['WM-ST-101-A-01','WM-ST-101-A-02'],action:'BLOCK',reason:'Sponsor allocation',operator:'admin@example.com'};
test('blocks only unsold unheld unreleased or available seats',()=>{const p=planSeatBlocks(args);assert.equal(p.executable,false);assert.equal(p.steps.length,2);assert.match(p.steps[0].sql,/status IN \('UNRELEASED','AVAILABLE'\)/);assert.match(p.steps[0].sql,/hold_id IS NULL/);assert.match(p.steps[0].sql,/shopify_order_id IS NULL/);});
test('unblocking returns to UNRELEASED, not sale-ready',()=>{const p=planSeatBlocks({...args,action:'UNBLOCK'});assert.match(p.steps[0].sql,/SET status='UNRELEASED'/);assert.match(p.steps[0].sql,/status='BLOCKED'/);});
test('rejects invalid selections and missing accountability',()=>{for(const x of [{skus:[]},{skus:[args.skus[0],args.skus[0]]},{skus:['BAD']},{reason:'x'},{operator:''},{action:'DELETE'}])assert.throws(()=>planSeatBlocks({...args,...x}));});
test('does not interpolate user data into SQL',()=>{const p=planSeatBlocks({...args,reason:"Sponsor's block",operator:'admin'});assert.equal(p.steps[0].params[0],args.skus[0]);assert.ok(!p.steps[0].sql.includes('Sponsor'));});
