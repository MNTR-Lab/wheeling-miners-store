import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const url='https://example.com';
test('admin routes reject missing token without reaching public API',async()=>{
 const response=await worker.fetch(new Request(url+'/api/seats/admin/summary'),{SEAT_DB:{},ASSETS:{fetch(){throw Error('asset route reached')}}});
 assert.equal(response.status,401);
});
test('admin write rejects missing token without database writes',async()=>{
 let calls=0;
 const db={prepare(){calls++;throw Error('should not query')}};
 const response=await worker.fetch(new Request(url+'/api/seats/admin/availability',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sku:'WM-ST-101-A-01',action:'BLOCK',reason:'Sponsor allocation',operator:'Admin User'})}),{SEAT_DB:db});
 assert.equal(response.status,401);assert.equal(calls,0);
});
test('public hold remains locked',async()=>{
 const response=await worker.fetch(new Request(url+'/api/seats/hold',{method:'POST'}),{SEAT_DB:{}});
 assert.equal(response.status,423);
});
test('public checkout remains locked',async()=>{
 const response=await worker.fetch(new Request(url+'/api/seats/checkout',{method:'POST'}),{SEAT_DB:{}});
 assert.equal(response.status,423);
});
test('public status is still handled by seat API',async()=>{
 const db={prepare(sql){return {all:async()=>({results:[]}),first:async()=>({count:0})}}};
 const response=await worker.fetch(new Request(url+'/api/seats/status'),{SEAT_DB:db});
 assert.equal(response.status,200);assert.equal((await response.json()).checkout_enabled,false);
});
