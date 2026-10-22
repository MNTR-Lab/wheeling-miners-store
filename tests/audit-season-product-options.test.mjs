import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOptions} from '../tools/audit-season-product-options.mjs';
const fixture=(options=['Row','Seat'])=>({data:{products:{nodes:[{id:'gid://shopify/Product/123',status:'DRAFT',options:options.map(name=>({name})),variants:{nodes:[{sku:'WM-ST-SEC-105',inventoryQuantity:0}]}}],pageInfo:{hasNextPage:false}}}});
test('ready with draft product and row/seat options',()=>{const r=auditOptions(fixture(),{expectedSections:1});assert.equal(r.ready_for_variant_creation,true);assert.equal(r.shopify_writes,0);});
test('fails closed on default option',()=>{const r=auditOptions(fixture(['Title']),{expectedSections:1});assert.equal(r.ready_for_variant_creation,false);assert.deepEqual(r.sections[0].issues,['ROW_SEAT_OPTIONS_MISSING']);});
test('rejects inventory on placeholder',()=>{const f=fixture();f.data.products.nodes[0].variants.nodes[0].inventoryQuantity=1;assert.equal(auditOptions(f,{expectedSections:1}).ready_for_variant_creation,false);});
test('rejects duplicate section products',()=>{const f=fixture();f.data.products.nodes.push({...f.data.products.nodes[0],id:'gid://shopify/Product/124'});assert.equal(auditOptions(f,{expectedSections:1}).ready_for_variant_creation,false);});
test('rejects incomplete pagination',()=>{const f=fixture();f.data.products.pageInfo.hasNextPage=true;assert.throws(()=>auditOptions(f),/pagination/);});
