import test from 'node:test';
import assert from 'node:assert/strict';
import {validateControlledRun,runControlledCheckout} from '../scripts/wm-controlled-checkout-run.mjs';
const sku='WM-ST-105-B-03',shop='wheeling-miners-ticket-testing.myshopify.com',token='x'.repeat(40);
const args={sku,confirmation:`CREATE TEST CART ${sku}`,environment:'TEST',shop,token};
test('rejects historical sold fixtures',()=>{for(const s of ['WM-ST-105-B-01','WM-ST-105-B-02'])assert.throws(()=>validateControlledRun({...args,sku:s}),/PROTECTED/)});
test('rejects wrong environment, store, and confirmation',()=>{for(const changes of [{environment:'PROD'},{shop:'real-store.myshopify.com'},{confirmation:'yes'}])assert.throws(()=>validateControlledRun({...args,...changes}))});
test('fails closed before writes when public checkout is enabled',async()=>{let calls=0;await assert.rejects(()=>runControlledCheckout({...args,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({mode:'STAGING',checkout_enabled:true,holds_enabled:false})}}}),/PUBLIC_CHECKOUT_NOT_LOCKED/);assert.equal(calls,1)});
test('runs release, reservation and cart in order for explicitly authorized TEST',async()=>{
 const paths=[];
 const fetchImpl=async(url,opts)=>{const path=new URL(url).pathname;paths.push(path);if(path==='/api/seats/status')return {ok:true,json:async()=>({mode:'STAGING',checkout_enabled:false,holds_enabled:false})};
  if(path.endsWith('/test-release'))return {ok:true,json:async()=>({sku,status:'AVAILABLE'})};
  if(path.endsWith('/test-reservation'))return {ok:true,json:async()=>({sku,reservationId:'wm_test_abcdefghijklmnopqrst',expiresAt:'2026-10-25T20:00:00Z',publicCheckoutEnabled:false})};
  return {ok:true,json:async()=>({mode:'CONTROLLED_CART_ONLY',reservationId:'wm_test_abcdefghijklmnopqrst',seatCount:1,publicCheckoutEnabled:false,checkoutUrl:`https://${shop}/checkouts/test`})};};
 const result=await runControlledCheckout({...args,fetchImpl});assert.match(result.checkoutUrl,/checkouts\/test/);assert.deepEqual(paths,['/api/seats/status','/api/seats/admin/test-release','/api/seats/admin/test-reservation','/api/seats/admin/controlled-cart']);
});
test('rejects a cart redirect to any other host',async()=>{
 const fetchImpl=async(url)=>{const p=new URL(url).pathname;return {ok:true,json:async()=>p==='/api/seats/status'?{mode:'STAGING',checkout_enabled:false,holds_enabled:false}:p.endsWith('test-release')?{sku,status:'AVAILABLE'}:p.endsWith('test-reservation')?{sku,reservationId:'wm_test_abcdefghijklmnopqrst',publicCheckoutEnabled:false}:{mode:'CONTROLLED_CART_ONLY',reservationId:'wm_test_abcdefghijklmnopqrst',seatCount:1,publicCheckoutEnabled:false,checkoutUrl:'https://malicious.example/checkout'}}};
 await assert.rejects(()=>runControlledCheckout({...args,fetchImpl}),/UNTRUSTED_CHECKOUT_HOST/);
});
