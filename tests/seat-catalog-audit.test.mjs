import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSection,seatCatalogAudit} from '../src/seat-catalog-audit.js';
const row={section:'105',seats:50,price_cents:16000,price_tiers:1,invalid_skus:0,mapped:0,active:0,sold:0,sold_test_fixtures:0};
test('unmapped staged section is eligible for draft preparation',()=>assert.equal(auditSection(row).ready_for_draft_variant_creation,true));
test('blocks inconsistent pricing',()=>assert.deepEqual(auditSection({...row,price_tiers:2}).issues,['PRICE_TIER_CONFLICT']));
test('blocks partial mapping and released seats',()=>assert.deepEqual(auditSection({...row,mapped:1,active:2}).issues,['PARTIAL_MAPPING','SEATS_NOT_STAGED']));
test('blocks Shopify variant limit',()=>assert.ok(auditSection({...row,seats:2049}).issues.includes('VARIANT_LIMIT')));
test('preserved section 105 SOLD test fixtures are not active or price conflicts',()=>{
 const result=auditSection({...row,mapped:50,price_tiers:2,sold:2,sold_test_fixtures:2,active:0});
 assert.deepEqual(result.issues,[]);assert.equal(result.ready_for_draft_variant_creation,false);
});
test('unexpected sold seats fail closed',()=>assert.ok(auditSection({...row,sold:3,sold_test_fixtures:2,price_tiers:2}).issues.includes('UNEXPECTED_SOLD_SEATS')));
test('unexpected sold fixtures outside 105 fail closed',()=>assert.ok(auditSection({...row,section:'106',sold:2,sold_test_fixtures:2,price_tiers:2}).issues.includes('UNEXPECTED_TEST_FIXTURES')));
test('audit is read-only and never enables sales',async()=>{
 let writes=0;const env={SEAT_DB:{prepare:()=>({all:async()=>({results:[row]}),run:async()=>{writes++}})}};
 const response=await seatCatalogAudit(new Request('https://example.test/api/seats/admin/catalog-audit'),env);
 const data=await response.json();assert.equal(response.status,200);assert.equal(data.sales_enabled,false);assert.equal(data.shopify_write_enabled,false);assert.equal(writes,0);
});
