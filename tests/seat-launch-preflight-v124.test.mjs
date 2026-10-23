import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLaunchInventory,inspectLaunchInventory} from '../src/seat-launch-preflight.js';
const clean={total:3737,sections:63,unreleased:3737,available:0,held:0,sold:0,blocked:0,mapped:3737};
const run=(summary=clean,duplicates={count:0},conflicts={count:0})=>evaluateLaunchInventory(summary,duplicates,conflicts);
test('fully unreleased and mapped inventory passes structural checks but never authorizes sales',()=>{
 const r=run();assert.equal(r.checksPassed,true);assert.equal(r.readyForSales,false);assert.equal(r.authorizationGranted,false);
 assert.equal(r.databaseMutations,0);assert.equal(r.shopifyMutations,0);
});
test('incorrect seat count fails',()=>assert.ok(run({...clean,total:3736}).issues.includes('SEAT_COUNT_MISMATCH')));
test('incorrect section count fails',()=>assert.ok(run({...clean,sections:62}).issues.includes('SECTION_COUNT_MISMATCH')));
test('unmapped variant fails',()=>assert.ok(run({...clean,mapped:3736}).issues.includes('UNMAPPED_SEATS')));
test('duplicate variant fails',()=>assert.ok(run(clean,{count:1}).issues.includes('DUPLICATE_VARIANTS')));
test('invalid seat states fail',()=>assert.ok(run(clean,{count:0},{count:1}).issues.includes('INCONSISTENT_SEAT_STATE')));
test('available inventory blocks staging-only readiness',()=>{
 const r=run({...clean,unreleased:3736,available:1});assert.ok(r.issues.includes('INVENTORY_NOT_FULLY_UNRELEASED'));
});
test('missing or negative database counts fail closed',()=>{
 assert.throws(()=>run({...clean,mapped:undefined}),/INVALID_INVENTORY_RESULT/);
 assert.throws(()=>run(clean,{count:-1}),/INVALID_INVENTORY_RESULT/);
});
test('preflight issues SELECT statements only',async()=>{
 const sql=[];const results=[clean,{count:0},{count:0}];
 const db={prepare(query){sql.push(query);return {first:async()=>results[sql.length-1]}}};
 const r=await inspectLaunchInventory(db);assert.equal(r.checksPassed,true);assert.equal(sql.length,3);
 assert.ok(sql.every(s=>s.startsWith('SELECT')));
});
test('database failures never become successful preflight',async()=>{
 const db={prepare(){return {first:async()=>null}}};
 await assert.rejects(inspectLaunchInventory(db),/INVALID_INVENTORY_RESULT/);
});
