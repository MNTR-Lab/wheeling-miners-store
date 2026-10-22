import {test} from 'node:test';import {strict as assert} from 'node:assert';import {buildMappingSql} from '../tools/build-d1-seat-mapping.mjs';
const seat={sku:'WM-ST-101-A-01',section:'101',row_label:'A',seat_number:'1',price_cents:'10000',status:'UNRELEASED',shopify_variant_id:'',section_product_sku:'WM-ST-SEC-101'};
const variant={sku:seat.sku,variant_id:'gid://shopify/ProductVariant/123',product_sku:seat.section_product_sku,price_cents:'10000',inventory_quantity:'0',product_status:'DRAFT'};
test('produces guarded atomic mapping',()=>{const sql=buildMappingSql([seat],[variant],{expectedSeats:1,expectedSections:1});assert.match(sql,/BEGIN TRANSACTION/);assert.match(sql,/seat_admin_guard/);assert.match(sql,/COMMIT/);assert.doesNotMatch(sql,/status='AVAILABLE'/);});
test('rejects missing Shopify mapping',()=>assert.throws(()=>buildMappingSql([seat],[],{expectedSeats:1,expectedSections:1}),/SEAT_COUNT_MISMATCH/));
test('rejects wrong prices',()=>assert.throws(()=>buildMappingSql([seat],[{...variant,price_cents:'9000'}],{expectedSeats:1,expectedSections:1}),/INVALID_SHOPIFY_VARIANT/));
test('rejects duplicate variants',()=>assert.throws(()=>buildMappingSql([seat,{...seat,sku:'WM-ST-101-A-02',seat_number:'2'}],[variant,{...variant,sku:'WM-ST-101-A-02'}],{expectedSeats:2,expectedSections:1}),/INVALID_SHOPIFY_VARIANT/));
