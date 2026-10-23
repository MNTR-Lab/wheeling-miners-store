/** Isolated, deterministic checkout rehearsal. No live Shopify, D1, or inventory writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlledSeatCart} from '../src/seat-shopify-cart.js';
import {handleAdminControlledCart} from '../src/seat-admin-controlled-cart.js';

const now=new Date('2026-10-23T12:00:00Z');
const expiry=now.getTime()+15*60*1000;
const reservation={id:'reservation_isolated_123456789',checkout_nonce:'nonce_isolated_12345678901234567890',status:'HELD',expires_at:expiry,shopify_order_id:null};
const linked=[{seat_sku:'WM-ST-105-B-01',shopify_variant_id:'gid://shopify/ProductVariant/987654321'}];
const rows=[{sku:linked[0].seat_sku,status:'HELD',hold_id:reservation.id,hold_expires_at:expiry,shopify_order_id:null,shopify_variant_id:linked[0].shopify_variant_id}];
const env={SEAT_CONTROLLED_CART_ENABLED:'true',SHOPIFY_STORE_DOMAIN:'isolated-test.myshopify.com',SHOPIFY_STOREFRONT_TOKEN:'not-a-real-token-123456'};
const args={reservation,linkedSeats:linked,seatRows:rows,env,now};
function mockShopify({tamper=null}={}){
 let calls=0;
 const fetchImpl=async(url,options)=>{
  calls++;
  assert.equal(url,'https://isolated-test.myshopify.com/api/2026-10/graphql.json');
  assert.equal(options.method,'POST');
  const payload=JSON.parse(options.body);
  assert.match(payload.query,/cartCreate/);
  assert.deepEqual(payload.variables.input.lines,[{merchandiseId:linked[0].shopify_variant_id,quantity:1}]);
  const attrs=payload.variables.input.attributes;
  assert.deepEqual(attrs,[{key:'wm_reservation_id',value:reservation.id},{key:'wm_checkout_nonce',value:reservation.checkout_nonce}]);
  let cart={id:'gid://shopify/Cart/12345',checkoutUrl:'https://isolated-test.myshopify.com/cart/c/isolated',attributes:attrs,lines:{nodes:[{quantity:1,merchandise:{id:linked[0].shopify_variant_id}}]}};
  if(tamper)cart=tamper(cart);
  return {ok:true,status:200,json:async()=>({data:{cartCreate:{cart,userErrors:[]}}})};
 };
 return {fetchImpl,get calls(){return calls}};
}

test('isolated happy-path cart preserves seat and reservation linkage, without real network',async()=>{
 const mock=mockShopify();
 const result=await createControlledSeatCart({...args,fetchImpl:mock.fetchImpl});
 assert.equal(mock.calls,1);
 assert.equal(result.mode,'CONTROLLED_CART_ONLY');
 assert.equal(result.reservationId,reservation.id);
 assert.equal(result.seatCount,1);
 assert.equal(result.inventoryChanged,false);
 assert.equal(result.publicCheckoutEnabled,false);
});

test('disabled switch prevents even mock Shopify calls',async()=>{
 const mock=mockShopify();
 await assert.rejects(createControlledSeatCart({...args,env:{...env,SEAT_CONTROLLED_CART_ENABLED:undefined},fetchImpl:mock.fetchImpl}),/CONTROLLED_CART_DISABLED/);
 assert.equal(mock.calls,0);
});

test('expired reservation is rejected before any Shopify call',async()=>{
 const mock=mockShopify();
 await assert.rejects(createControlledSeatCart({...args,now:new Date(expiry+1),fetchImpl:mock.fetchImpl}),/RESERVATION_EXPIRED/);
 assert.equal(mock.calls,0);
});

test('unreleased seat is rejected before any Shopify call',async()=>{
 const mock=mockShopify();
 await assert.rejects(createControlledSeatCart({...args,seatRows:[{...rows[0],status:'UNRELEASED'}],fetchImpl:mock.fetchImpl}),/SEAT_NOT_HELD_BY_RESERVATION/);
 assert.equal(mock.calls,0);
});

test('different reservation owner is rejected before any Shopify call',async()=>{
 const mock=mockShopify();
 await assert.rejects(createControlledSeatCart({...args,seatRows:[{...rows[0],hold_id:'reservation_another_123456789'}],fetchImpl:mock.fetchImpl}),/SEAT_NOT_HELD_BY_RESERVATION/);
 assert.equal(mock.calls,0);
});

test('mismatched Shopify variant is rejected before any Shopify call',async()=>{
 const mock=mockShopify();
 await assert.rejects(createControlledSeatCart({...args,seatRows:[{...rows[0],shopify_variant_id:'gid://shopify/ProductVariant/123456789'}],fetchImpl:mock.fetchImpl}),/SHOPIFY_VARIANT_MISMATCH/);
 assert.equal(mock.calls,0);
});

test('cart response with altered checkout attributes is rejected',async()=>{
 const mock=mockShopify({tamper:cart=>({...cart,attributes:[{key:'wm_reservation_id',value:'other'}]})});
 await assert.rejects(createControlledSeatCart({...args,fetchImpl:mock.fetchImpl}),/SHOPIFY_CART_ATTRIBUTE_MISMATCH/);
});

test('cart response with extra merchandise is rejected',async()=>{
 const mock=mockShopify({tamper:cart=>({...cart,lines:{nodes:[...cart.lines.nodes,{quantity:1,merchandise:{id:'gid://shopify/ProductVariant/111'}}]}})});
 await assert.rejects(createControlledSeatCart({...args,fetchImpl:mock.fetchImpl}),/SHOPIFY_CART_LINE_MISMATCH/);
});

test('cart response with outside checkout domain is rejected',async()=>{
 const mock=mockShopify({tamper:cart=>({...cart,checkoutUrl:'https://attacker.invalid/cart'})});
 await assert.rejects(createControlledSeatCart({...args,fetchImpl:mock.fetchImpl}),/UNTRUSTED_CHECKOUT_URL/);
});

test('admin route disabled by default, without reading D1 or contacting Shopify',async()=>{
 let reads=0,network=0;
 const db={prepare(){reads++;throw Error('unexpected database access')}};
 const req=new Request('https://example.invalid/api/seats/admin/controlled-cart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reservationId:reservation.id})});
 const result=await handleAdminControlledCart(req,{...env,SEAT_CONTROLLED_CART_ENABLED:undefined,SEAT_DB:db},{fetchImpl:()=>{network++;throw Error('unexpected network access')},now});
 assert.equal(result.status,423);
 assert.equal((await result.json()).error,'CONTROLLED_CART_DISABLED');
 assert.equal(reads,0);
 assert.equal(network,0);
});
