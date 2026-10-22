import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAtomicHoldBatch} from '../tools/seat-hold-transaction.mjs';
const input={skus:['WM-ST-101-A-01','WM-ST-101-A-02'],now:1000,reservationId:'review-1'};
test('review plan is not executable',()=>{const p=buildAtomicHoldBatch(input);assert.equal(p.executable,false);assert.equal(p.sales_enabled,false);assert.equal(p.checkout_enabled,false)});
test('retains exact selected seats',()=>{const p=buildAtomicHoldBatch(input);assert.equal(p.hold_plan.seatCount,2);assert.equal(p.hold_plan.steps.filter(s=>s.requiredChanges===1).length,2)});
test('rejects duplicate seat selection',()=>assert.throws(()=>buildAtomicHoldBatch({...input,skus:[input.skus[0],input.skus[0]]}),/duplicate/));
test('calls out required staging validation',()=>assert.match(buildAtomicHoldBatch(input).prerequisites.join(' '),/rollback/));
