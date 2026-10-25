import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditSection,seatCatalogAudit} from '../src/seat-catalog-audit.js';
import {mappingReport} from '../src/seat-mapping-report.js';
import {seatVariantManifest,formatVariant} from '../src/seat-variant-manifest.js';
const schema=new Set(['sku','section','row_label','seat_number','price_cents','status','hold_id','hold_expires_at','shopify_order_id','shopify_variant_id','updated_at']);
const mkEnv=(handler)=>({SEAT_DB:{prepare(sql){
 const normalized=sql.replaceAll("('WM-ST-SEC-' || section) AS section_product_sku",'');
 assert.ok(!/\bsection_product_sku\b/.test(normalized),'Must derive section_product_sku');
 return {
  bind(...args){return {first:()=>handler(sql,args,'first'),all:()=>handler(sql,args,'all')};},
  first:()=>handler(sql,[],'first'),
  all:()=>handler(sql,[],'all')
 };
}}});
const req=(path)=>new Request('https://test.invalid'+path);
test('catalog audit handles TEST sold fixtures and derives section product SKU',async()=>{
 const row=auditSection({section:'105',seats:37,price_cents:16000,price_tiers:2,invalid_skus:0,mapped:37,active:2,sold_test_fixtures:2});
 assert.equal(row.section_product_sku,'WM-ST-SEC-105');assert.ok(row.issues.includes('SEATS_NOT_STAGED'));assert.ok(!row.issues.includes('PRICE_TIER_CONFLICT'));
 const env=mkEnv(()=>({results:[{section:'105',seats:37,price_cents:16000,price_tiers:2,invalid_skus:0,mapped:37,active:2,sold_test_fixtures:2}]}));
 const r=await seatCatalogAudit(req('/api/seats/admin/catalog-audit'),env);assert.equal(r.status,200);assert.equal((await r.json()).sales_enabled,false);
});
test('mapping report paginates using existing TEST schema',async()=>{
 const env=mkEnv((sql,args,method)=>method==='first'?sql.includes('GROUP BY shopify_variant_id')?{count:0}:{total:3737,sections:63,mapped:3737,unreleased:3735,sold:2}:{results:[{sku:'WM-ST-105-B-03',section:'105',section_product_sku:'WM-ST-SEC-105'}]});
 const r=await mappingReport(req('/api/seats/admin/mapping-report?page=1&size=25'),env);assert.equal(r.status,200);const j=await r.json();assert.equal(j.inventory.total,3737);assert.equal(j.seats[0].section_product_sku,'WM-ST-SEC-105');
});
test('variant manifest excludes SOLD test seats and keeps zero inventory',async()=>{
 const env=mkEnv((sql,args,method)=>method==='first'?sql.includes('eligible')?{count:35}:{count:37,products:1,price_tiers:2,min_price_cents:100,max_price_cents:16000}:{results:[{sku:'WM-ST-105-B-03',section:'105',row_label:'B',seat_number:3,price_cents:16000,section_product_sku:'WM-ST-SEC-105',status:'UNRELEASED',shopify_variant_id:'gid://shopify/ProductVariant/51444151386281'}]});
 const r=await seatVariantManifest(req('/api/seats/admin/variant-manifest?section=105'),env);assert.equal(r.status,200);const j=await r.json();assert.equal(j.variants[0].initial_inventory_quantity,0);assert.equal(j.variants[0].price,'160.00');assert.equal(j.sales_enabled,false);
 assert.throws(()=>formatVariant({sku:'WM-ST-105-B-01',price_cents:100,status:'SOLD'}));
});
test('all three replacement modules contain no database mutations',()=>{
 for(const file of ['seat-catalog-audit.js','seat-mapping-report.js','seat-variant-manifest.js']){
  const src=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.ok(!/\b(?:UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE|DROP TABLE)\s+seats\b/i.test(src));
 }
});
