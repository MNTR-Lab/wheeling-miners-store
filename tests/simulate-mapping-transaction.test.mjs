import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const seat={sku:'WM-ST-105-A-01',section:'105',row_label:'A',seat_number:'1',price_cents:'16000',status:'UNRELEASED',shopify_variant_id:''};
const variant={sku:seat.sku,variant_id:'gid://shopify/ProductVariant/123',product_sku:'WM-ST-SEC-105',price_cents:'16000',inventory_quantity:'0',product_status:'DRAFT'};
const approval={sku:seat.sku,section:'105',row_label:'A',seat_number:'1',price_cents:'16000',approved:'YES'};
// Representative V46 transaction fixture; production SQL must be independently reviewed.
const script=`-- V46 REVIEW ONLY. DO NOT RUN DIRECTLY AGAINST CLOUDFLARE D1 HTTP API.
BEGIN IMMEDIATE;
CREATE TEMP TABLE _wm_mapping (sku TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE);
INSERT INTO _wm_mapping(sku,variant_id) VALUES('WM-ST-105-A-01','gid://shopify/ProductVariant/123');
CREATE TEMP TABLE _wm_guard (value INTEGER NOT NULL CHECK(value=1));
INSERT INTO _wm_guard SELECT CASE WHEN (SELECT COUNT(*) FROM _wm_mapping)=1 AND (SELECT COUNT(*) FROM seats)=1 AND (SELECT COUNT(*) FROM seats WHERE status='UNRELEASED' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)=''))=1 AND (SELECT COUNT(*) FROM _wm_mapping m JOIN seats s ON s.sku=m.sku)=1 THEN 1 ELSE 0 END;
UPDATE seats SET shopify_variant_id=(SELECT variant_id FROM _wm_mapping WHERE sku=seats.sku),updated_at=CURRENT_TIMESTAMP WHERE sku IN (SELECT sku FROM _wm_mapping) AND status='UNRELEASED' AND (shopify_variant_id IS NULL OR TRIM(shopify_variant_id)='');
INSERT INTO _wm_guard SELECT CASE WHEN (SELECT COUNT(*) FROM seats s JOIN _wm_mapping m ON m.sku=s.sku AND m.variant_id=s.shopify_variant_id)=1 AND (SELECT COUNT(*) FROM seats WHERE status='UNRELEASED')=1 THEN 1 ELSE 0 END;
DROP TABLE _wm_guard;
DROP TABLE _wm_mapping;
COMMIT;`;
function run(sql,rows){
 const dir=mkdtempSync(join(tmpdir(),'wm-v47-'));
 try{
  writeFileSync(join(dir,'review.sql'),sql);
  writeFileSync(join(dir,'fixture.json'),JSON.stringify({seats:rows}));
  const proc=spawnSync('python3',['tools/simulate-mapping-transaction.py',join(dir,'review.sql'),join(dir,'fixture.json')],{encoding:'utf8'});
  if(proc.error)throw proc.error;
  return {exit:proc.status,result:proc.stdout ? JSON.parse(proc.stdout) : null,stderr:proc.stderr};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('valid review maps variant in memory, without releasing seat',()=>{
 const x=run(script,[seat]);assert.equal(x.exit,0);assert.equal(x.result.mapped_after,1);
 assert.equal(x.result.statuses_unchanged,true);assert.equal(x.result.production_writes,0);
});
test('unexpected extra D1 seat aborts transaction with zero changes',()=>{
 const x=run(script,[seat,{...seat,sku:'WM-ST-105-A-02'}]);assert.equal(x.exit,1);
 assert.equal(x.result.rolled_back_unchanged,true);assert.equal(x.result.mapped_after,0);
});
test('already mapped seat aborts and leaves original mapping untouched',()=>{
 const x=run(script,[{...seat,shopify_variant_id:'gid://shopify/ProductVariant/999'}]);assert.equal(x.exit,1);
 assert.equal(x.result.rolled_back_unchanged,true);assert.equal(x.result.mapped_after,1);
});
test('released seat aborts and preserves status',()=>{
 const x=run(script,[{...seat,status:'AVAILABLE'}]);assert.equal(x.exit,1);
 assert.equal(x.result.rolled_back_unchanged,true);assert.equal(x.result.statuses_unchanged,true);
});
test('unrecognized SQL rejected before execution',()=>{
 const x=run('UPDATE seats SET status="AVAILABLE";', [seat]);assert.equal(x.exit,2);
 assert.match(x.stderr,/Only V46 review scripts/);
});
