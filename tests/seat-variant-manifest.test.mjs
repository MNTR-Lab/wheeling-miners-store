import test from 'node:test';
import assert from 'node:assert/strict';
import {formatVariant,seatVariantManifest} from '../src/seat-variant-manifest.js';
const row={sku:'WM-ST-105-B-06',section:'105',row_label:'B',seat_number:6,price_cents:17500,section_product_sku:'WM-ST-SEC-105',status:'UNRELEASED',shopify_variant_id:null};
test('one unique variant represents one full-season seat',()=>{const x=formatVariant(row);assert.equal(x.sku,row.sku);assert.equal(x.price,'175.00');assert.equal(x.inventory_policy,'DENY');assert.equal(x.initial_inventory_quantity,0);});
test('reject unsafe prices and statuses',()=>{assert.throws(()=>formatVariant({...row,price_cents:0}));assert.throws(()=>formatVariant({...row,status:'SOLD'}));});
test('manifest never writes and remains staging',async()=>{let writes=0;const db={prepare:()=>({bind(){return this;},first:async()=>({count:1,products:1,price_tiers:1,min_price_cents:17500,max_price_cents:17500}),all:async()=>({results:[row]}),run:async()=>{writes++;}})};const r=await seatVariantManifest(new Request('https://example.com/api/seats/admin/variant-manifest?section=105'),{SEAT_DB:db});const j=await r.json();assert.equal(r.status,200);assert.equal(j.sales_enabled,false);assert.equal(j.shopify_write_enabled,false);assert.equal(j.variants.length,1);assert.equal(writes,0);});
test('reject missing section',async()=>{const r=await seatVariantManifest(new Request('https://example.com/api/seats/admin/variant-manifest'),{});assert.equal(r.status,400);});
