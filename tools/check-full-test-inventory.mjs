/** TEST-only exhaustive public read audit. No authentication, no mutations. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const BASE='https://wheeling-miners-store-test.bikard.workers.dev';
async function read(path){
  const response=await fetch(BASE+path,{redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,`${path}: HTTP ${response.status}`);
  return response.json();
}
const status=await read('/api/seats/status');
assert.equal(status.mode,'STAGING');
assert.equal(status.checkout_enabled,false);
assert.equal(status.holds_enabled,false);
assert.equal(Number(status.shopify_mapped_seats),3737);
const counts=Object.fromEntries(status.inventory.map(({status,count})=>[status,Number(count)]));
assert.equal(counts.SOLD,2);assert.equal(counts.UNRELEASED,3735);
assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),3737);
const readiness=await read('/api/seats/readiness');
assert.equal(readiness.ready_for_sales,false);
assert.equal(readiness.checkout_enabled,false);
assert.equal(readiness.holds_enabled,false);
assert.equal(Number(readiness.inventory.sections),63);
assert.equal(Number(readiness.duplicate_variant_ids),0);
const manifest=readFileSync(new URL('../data/staging/d1-seats.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
assert.equal(manifest[0],'sku,section,row_label,seat_number,price_cents,status,shopify_variant_id');
const expected=new Map(manifest.slice(1).map(line=>{
  const [sku,section,row,number,price]=line.split(',');
  return [sku,{section,row,number:Number(number),price:Number(price)}];
}));
assert.equal(expected.size,3737,'Manifest must contain 3737 unique seat SKUs');
const sectionNames=[...new Set([...expected.values()].map(x=>x.section))].sort();
assert.equal(sectionNames.length,63,'Manifest must contain 63 sections');
const seats=[];
for(const key of sectionNames){
  const response=await fetch(BASE+'/api/seats/section/'+key,{redirect:'error',signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,`Section ${key} returned HTTP ${response.status}`);
  const data=await response.json();
  assert.equal(data.section,key);assert.equal(data.checkout_enabled,false);
  assert.ok(Array.isArray(data.seats)&&data.seats.length>0,`Empty section ${key}`);
  for(const seat of data.seats){
    assert.match(seat.sku,/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/);
    const match=seat.sku.match(/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/);
    assert.equal(match[1],key,`SKU section mismatch ${seat.sku}`);
    assert.equal(match[2],seat.row,`SKU row mismatch ${seat.sku}`);
    assert.equal(Number(match[3]),Number(seat.seat_number),`SKU seat number mismatch ${seat.sku}`);
    assert.ok(Number.isSafeInteger(seat.price_cents)&&seat.price_cents>0,`Invalid price ${seat.sku}`);
    assert.ok(['SOLD','UNRELEASED'].includes(seat.status),`Unexpected seat status ${seat.sku}: ${seat.status}`);
    const source=expected.get(seat.sku);assert.ok(source,`Unapproved SKU ${seat.sku}`);
    assert.equal(source.section,key);assert.equal(source.row,seat.row);
    assert.equal(source.number,Number(seat.seat_number));
    if(seat.status==='UNRELEASED')assert.equal(source.price,seat.price_cents,`Price mismatch ${seat.sku}`);
    seats.push(seat);
  }
}
assert.equal(sectionNames.length,63,'Unexpected number of sections');
assert.equal(seats.length,3737,'Missing or extra seats in section API');
assert.equal(new Set(seats.map(s=>s.sku)).size,3737,'Duplicate seat SKUs');
const sold=seats.filter(s=>s.status==='SOLD');
assert.deepEqual(sold.map(s=>s.sku).sort(),['WM-ST-105-B-01','WM-ST-105-B-02']);
assert.ok(sold.every(s=>s.price_cents===100),'Test fixtures must retain $1 prices');
assert.equal(seats.filter(s=>s.status==='UNRELEASED').length,3735);
assert.ok(seats.filter(s=>s.status==='UNRELEASED').every(s=>s.price_cents!==100),'Unexpected $1 staged ticket');
console.log(`PASS: ${seats.length} unique TEST seats in ${sectionNames.length} sections; 3735 unreleased; 2 preserved sold fixtures; no public checkout.`);
