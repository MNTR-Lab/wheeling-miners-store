/** V48: full-size SYNTHETIC integration test; never uses real venue approval. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildMappingReview} from '../tools/build-mapping-review.mjs';

export function syntheticFixture(){
 const seats=[],variants=[],manifest=[];
 for(let i=0;i<63;i++){
  const section=String(101+i),count=i===62?17:60;
  for(let j=0;j<count;j++){
   const row=String.fromCharCode(65+Math.floor(j/10));
   const seat_number=String(j%10+1),sku=`WM-ST-${section}-${row}-${seat_number.padStart(2,'0')}`;
   const price_cents=i<20?'16000':i<40?'11000':'6500';
   seats.push({sku,section,row_label:row,seat_number,price_cents,status:'UNRELEASED',shopify_variant_id:''});
   manifest.push({sku,section,row_label:row,seat_number,price_cents,approved:'YES'});
   variants.push({sku,variant_id:`gid://shopify/ProductVariant/${900000000+j+i*100}`,product_sku:`WM-ST-SEC-${section}`,price_cents,inventory_quantity:'0',product_status:'DRAFT'});
  }
 }
 return {seats,variants,manifest};
}
function simulate(sql,seats){
 const dir=mkdtempSync(join(tmpdir(),'wm-v48-'));
 try{
  const sqlFile=join(dir,'review.sql'),fixtureFile=join(dir,'fixture.json');
  writeFileSync(sqlFile,sql);writeFileSync(fixtureFile,JSON.stringify({seats}));
  const p=spawnSync('python3',['tools/simulate-mapping-transaction.py',sqlFile,fixtureFile],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  if(p.error)throw p.error;
  return {exit:p.status,output:p.stdout?JSON.parse(p.stdout):null,stderr:p.stderr};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const fixture=syntheticFixture();
test('synthetic fixture covers exactly 3,737 unique seats across 63 sections',()=>{
 assert.equal(fixture.seats.length,3737);
 assert.equal(new Set(fixture.seats.map(s=>s.section)).size,63);
 assert.equal(new Set(fixture.seats.map(s=>s.sku)).size,3737);
});
test('V46 produces complete review SQL for 3,737 independently supplied synthetic approvals',()=>{
 const result=buildMappingReview(fixture.seats,fixture.variants,fixture.manifest);
 assert.equal(result.ready,true,JSON.stringify(result.issues?.slice(0,3)));
 assert.equal(result.expected,3737);
 assert.equal(result.executed,false);
 assert.equal(result.sales_enabled,false);
 assert.equal((result.sql.match(/INSERT INTO _wm_mapping\(/g)||[]).length,3737);
});
test('V46 SQL maps all 3,737 synthetic seats in isolated SQLite without releasing them',()=>{
 const sql=buildMappingReview(fixture.seats,fixture.variants,fixture.manifest).sql;
 const result=simulate(sql,fixture.seats);
 assert.equal(result.exit,0,result.stderr||result.output?.error);
 assert.equal(result.output.mapped_after,3737);
 assert.equal(result.output.statuses_unchanged,true);
 assert.equal(result.output.production_writes,0);
 assert.equal(result.output.sales_enabled,false);
});
test('one preexisting mapping causes full transaction rollback, not partial writes',()=>{
 const sql=buildMappingReview(fixture.seats,fixture.variants,fixture.manifest).sql;
 const changed=fixture.seats.map((s,i)=>i===1800?{...s,shopify_variant_id:'gid://shopify/ProductVariant/999999999'}:s);
 const result=simulate(sql,changed);
 assert.equal(result.exit,1,result.stderr);
 assert.equal(result.output.rolled_back_unchanged,true);
 assert.equal(result.output.mapped_after,1);
});
test('one released seat causes full rollback',()=>{
 const sql=buildMappingReview(fixture.seats,fixture.variants,fixture.manifest).sql;
 const changed=fixture.seats.map((s,i)=>i===2500?{...s,status:'AVAILABLE'}:s);
 const result=simulate(sql,changed);
 assert.equal(result.exit,1,result.stderr);
 assert.equal(result.output.rolled_back_unchanged,true);
 assert.equal(result.output.mapped_after,0);
});
test('one unapproved manifest seat blocks SQL generation entirely',()=>{
 const changed=fixture.manifest.map((s,i)=>i===1200?{...s,approved:'NO'}:s);
 const result=buildMappingReview(fixture.seats,fixture.variants,changed);
 assert.equal(result.ready,false);assert.equal(result.sql,null);
});
test('duplicate Shopify variant blocks SQL generation entirely',()=>{
 const changed=fixture.variants.map((s,i)=>i===1200?{...s,variant_id:fixture.variants[2].variant_id}:s);
 const result=buildMappingReview(fixture.seats,changed,fixture.manifest);
 assert.equal(result.ready,false);assert.equal(result.sql,null);
});
