import test from 'node:test';import assert from 'node:assert/strict';
import {validateTestCheckoutSeat} from '../scripts/wm-test-checkout-preflight.mjs';
const sku='WM-ST-105-B-03',variant='gid://shopify/ProductVariant/50943009259578';
const seat={sku,status:'UNRELEASED',hold_id:null,shopify_order_id:null,shopify_variant_id:variant,price_cents:16000};
test('accepts only an unused approved TEST seat',()=>assert.equal(validateTestCheckoutSeat(seat,{sku,variant}),true));
test('rejects historical SOLD fixtures',()=>assert.throws(()=>validateTestCheckoutSeat({...seat,sku:'WM-ST-105-B-02'},{sku:'WM-ST-105-B-02',variant}))); 
test('rejects paid or held seats',()=>{for(const change of [{status:'SOLD'},{status:'HELD'},{hold_id:'existing'},{shopify_order_id:'123'}])assert.throws(()=>validateTestCheckoutSeat({...seat,...change},{sku,variant}))});
test('rejects incorrect variants and $1 test prices',()=>{assert.throws(()=>validateTestCheckoutSeat({...seat,shopify_variant_id:'other'},{sku,variant}));assert.throws(()=>validateTestCheckoutSeat({...seat,price_cents:100},{sku,variant}))});
