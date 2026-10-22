import test from 'node:test';import assert from 'node:assert/strict';import {resolveSections} from '../tools/resolve-season-section-products.mjs';
function p(section,id,status='DRAFT',options=['Title']){return {id:`gid://shopify/Product/${id}`,title:`Wheeling Miners | Season Tickets | Section ${section}`,status,options:options.map(name=>({name})),variants:{pageInfo:{hasNextPage:false},nodes:[{id:`gid://shopify/ProductVariant/${id}`,sku:`WM-ST-SEC-${section}`,inventoryQuantity:0,price:'160.00'}]}};}
test('ignores archived duplicate while selecting draft',()=>{const r=resolveSections([p('209',1),p('209',2,'ARCHIVED')],{expected:1});assert.equal(r.ready,true);assert.equal(r.sections[0].product_id,'gid://shopify/Product/1');assert.equal(r.ignored_archived.length,1)});
test('blocks two drafts with same section',()=>{const r=resolveSections([p('209',1),p('209',2)],{expected:1});assert.equal(r.ready,false);assert.match(r.errors.join(' '),/expected one DRAFT/)});
test('blocks missing section',()=>assert.equal(resolveSections([p('105',1)],{expected:63}).ready,false));
test('blocks nonzero stock',()=>{const x=p('105',1);x.variants.nodes[0].inventoryQuantity=1;assert.equal(resolveSections([x],{expected:1}).ready,false)});
test('blocks incomplete pagination',()=>{assert.throws(()=>resolveSections({nodes:[p('105',1)],pageInfo:{hasNextPage:true}}),/incomplete/)});
test('recognizes converted Row and Seat options',()=>{const r=resolveSections([p('105',1,'DRAFT',['Row','Seat'])],{expected:1});assert.equal(r.ready,true);assert.equal(r.already_ready,1)});
