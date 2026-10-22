import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportSeatProducts,validateDomain} from '../tools/fetch-shopify-seat-products.mjs';
const variant=(id)=>({id:'gid://shopify/ProductVariant/'+id,sku:'WM-ST-105-A-'+id,price:'160.00',inventoryQuantity:0,inventoryPolicy:'DENY'});
const page=(nodes,hasNextPage=false,endCursor=null)=>({nodes,pageInfo:{hasNextPage,endCursor}});
const product={id:'gid://shopify/Product/1',status:'DRAFT',options:[{name:'Row'},{name:'Seat'}],variants:page([variant(1)],true,'v1')};
function fake(responses){const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return {ok:true,json:async()=>({data:responses.shift()})};}};}
test('rejects invalid domain and missing token',async()=>{assert.throws(()=>validateDomain('https://evil.example'),/domain/);await assert.rejects(exportSeatProducts({domain:'store.myshopify.com'}),/TOKEN/);});
test('paginates products and variants without mutations',async()=>{const f=fake([{products:page([product],true,'p1')},{product:{id:product.id,variants:page([variant(2)])}},{products:page([{...product,id:'gid://shopify/Product/2',variants:page([variant(3)])}])}]);const x=await exportSeatProducts({domain:'store.myshopify.com',token:'secret',fetchImpl:f.fetchImpl});assert.equal(x.meta.product_count,2);assert.equal(x.meta.variant_count,3);assert.equal(x.data.products.nodes[0].variants.nodes.length,2);assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.options.method==='POST'&&!/mutation\b/i.test(c.body.query)));assert.ok(f.calls.every(c=>c.options.headers['x-shopify-access-token']==='secret'));});
test('fails closed on repeated product cursor',async()=>{const f=fake([{products:page([],true,'same')},{products:page([],true,'same')}]);await assert.rejects(exportSeatProducts({domain:'store.myshopify.com',token:'secret',fetchImpl:f.fetchImpl}),/cursor/);});
test('fails closed on GraphQL errors',async()=>{const f=async()=>({ok:true,json:async()=>({errors:[{message:'denied'}]})});await assert.rejects(exportSeatProducts({domain:'store.myshopify.com',token:'secret',fetchImpl:f}),/denied/);});
test('rejects HTTP errors',async()=>{const f=async()=>({ok:false,status:401});await assert.rejects(exportSeatProducts({domain:'store.myshopify.com',token:'secret',fetchImpl:f}),/401/);});
