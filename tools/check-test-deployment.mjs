/** TEST-only, read-only post-deployment verification. */
import assert from 'node:assert/strict';
const base='https://wheeling-miners-store-test.bikard.workers.dev';
async function get(path, options={}) {
  const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(20000),...options});
  const raw=await response.text();let body;try{body=JSON.parse(raw)}catch{body=raw}
  return {status:response.status,body};
}
const status=await get('/api/seats/status');
assert.equal(status.status,200,JSON.stringify(status));
assert.equal(status.body.mode,'STAGING');
assert.equal(status.body.checkout_enabled,false);
assert.equal(status.body.holds_enabled,false);
assert.equal(Number(status.body.shopify_mapped_seats),3737);
const counts=Object.fromEntries(status.body.inventory.map(x=>[x.status,Number(x.count)]));
assert.equal(counts.SOLD,2);
assert.equal(counts.UNRELEASED,3735);
assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),3737);
const readiness=await get('/api/seats/readiness');
assert.equal(readiness.status,200,JSON.stringify(readiness));
assert.equal(readiness.body.ready_for_sales,false);
assert.equal(readiness.body.checkout_enabled,false);
assert.equal(Number(readiness.body.inventory.sections),63);
assert.equal(Number(readiness.body.duplicate_variant_ids),0);
for(const section of ['105','328']){
  const r=await get('/api/seats/section/'+section);
  assert.equal(r.status,200,JSON.stringify(r));
  assert.ok(r.body.seats.length>0);
  assert.equal(r.body.checkout_enabled,false);
  if(section==='105'){
    for(const sku of ['WM-ST-105-B-01','WM-ST-105-B-02']){
      assert.ok(r.body.seats.some(x=>x.sku===sku&&x.status==='SOLD'),sku+' must remain SOLD');
    }
  }
}
for(const path of ['/api/seats/hold','/api/seats/checkout']){
  const r=await get(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,423,path+' must remain locked');
}
const admin=await get('/api/seats/admin/summary');
assert.equal(admin.status,401,'Admin must require authentication');
const selector=await get('/seat-selector.html');
assert.equal(selector.status,200);
assert.match(selector.body,/<html/i);
console.log('PASS: TEST Worker deployed; 3,737 seats, 63 sections, 2 SOLD fixtures, public checkout locked, admin protected.');
