/** Read-only public TEST seat API and selector smoke checks. No secrets or mutations. */
import assert from 'node:assert/strict';
const base='https://wheeling-miners-store-test.bikard.workers.dev';
async function request(path,{method='GET',body}={}){
 const res=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 const text=await res.text();let data;try{data=JSON.parse(text)}catch{data=text};return {status:res.status,data};
}
const status=await request('/api/seats/status');assert.equal(status.status,200,JSON.stringify(status));
assert.equal(status.data.checkout_enabled,false);assert.equal(status.data.holds_enabled,false);
assert.equal(Number(status.data.shopify_mapped_seats),3737);
const inventory=Object.fromEntries(status.data.inventory.map(x=>[x.status,Number(x.count)]));
assert.equal(inventory.SOLD,2);assert.equal(inventory.UNRELEASED,3735);
assert.equal(Object.values(inventory).reduce((a,b)=>a+b,0),3737);
const readiness=await request('/api/seats/readiness');assert.equal(readiness.status,200,JSON.stringify(readiness));
assert.equal(readiness.data.ready_for_sales,false);assert.equal(readiness.data.checkout_enabled,false);
assert.equal(Number(readiness.data.inventory.total),3737);assert.equal(Number(readiness.data.inventory.sections),63);
assert.equal(Number(readiness.data.duplicate_variant_ids),0);
for(const section of ['105','328']){
 const r=await request('/api/seats/section/'+section);assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(r.data.checkout_enabled,false);assert.ok(r.data.seats.length>0);
 for(const s of r.data.seats){assert.ok(/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(s.sku));}
 if(section==='105'){
  assert.equal(r.data.seats.filter(s=>s.status==='SOLD').length,2);
  assert.ok(r.data.seats.some(s=>s.sku==='WM-ST-105-B-01'&&s.status==='SOLD'));
  assert.ok(r.data.seats.some(s=>s.sku==='WM-ST-105-B-02'&&s.status==='SOLD'));
 }
}
const admin=await request('/api/seats/admin/summary');assert.equal(admin.status,401,'Admin API must require token');
const selector=await request('/seat-selector.html');assert.equal(selector.status,200,'Selector HTML must load');
assert.match(selector.data,/<!doctype html|<html/i);
console.log('PASS: Live TEST inventory 3737/63; 3735 unreleased; 2 sold; no public checkout; admin unauthorized; selector reachable.');
