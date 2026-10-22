import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSection,seatCatalogAudit} from '../src/seat-catalog-audit.js';
const row={section:'105',seats:50,section_product_sku:'WM-ST-SEC-105',price_cents:17500,price_tiers:1,product_skus:1,invalid_skus:0,mapped:0,active:0};
test('safe staging section eligible for draft preparation',()=>assert.equal(auditSection(row).ready_for_draft_variant_creation,true));
test('blocks section with inconsistent pricing',()=>assert.deepEqual(auditSection({...row,price_tiers:2}).issues,['PRICE_TIER_CONFLICT']));
test('blocks partial mappings and active seats',()=>assert.deepEqual(auditSection({...row,mapped:1,active:2}).issues,['PARTIAL_MAPPING','SEATS_NOT_STAGED']));
test('blocks Shopify per-product variant overage',()=>assert.ok(auditSection({...row,seats:2049}).issues.includes('VARIANT_LIMIT')));
test('read only audit never writes',async()=>{let writes=0;const env={SEAT_DB:{prepare:()=>({all:async()=>({results:[row]}),run:async()=>{writes++}})}};const response=await seatCatalogAudit(new Request('https://example.test/api/seats/admin/catalog-audit'),env);const data=await response.json();assert.equal(response.status,200);assert.equal(data.sales_enabled,false);assert.equal(data.shopify_write_enabled,false);assert.equal(writes,0);});
