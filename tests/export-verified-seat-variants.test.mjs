import test from 'node:test';import assert from 'node:assert/strict';import {exportVerified} from '../tools/export-verified-seat-variants.mjs';
const p=()=>({id:'gid://shopify/Product/1',title:'Wheeling Miners | Season Tickets | Section 105',status:'DRAFT',options:[{name:'Row'},{name:'Seat'}],variants:{pageInfo:{hasNextPage:false},nodes:[{sku:'WM-ST-SEC-105',inventoryQuantity:0},{id:'gid://shopify/ProductVariant/2',sku:'WM-ST-105-B-06',price:'160.00',inventoryQuantity:0,inventoryPolicy:'DENY'}]}});
test('verified export creates V45 mapping CSV',()=>{const r=exportVerified([p()],{expectedSeats:1,expectedSections:1});assert.equal(r.ready,true);assert.match(r.csv,/WM-ST-105-B-06/)});
test('unreleased inventory only',()=>{const x=p();x.variants.nodes[1].inventoryQuantity=1;assert.equal(exportVerified([x],{expectedSeats:1,expectedSections:1}).ready,false)});
test('incomplete Shopify pagination rejected',()=>assert.throws(()=>exportVerified({pageInfo:{hasNextPage:true},nodes:[p()]}),/pagination/));
test('archived duplicate excluded',()=>{const x=p();x.status='ARCHIVED';const r=exportVerified([p(),x],{expectedSeats:1,expectedSections:1});assert.equal(r.ready,true)});
