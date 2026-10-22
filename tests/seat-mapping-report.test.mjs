import test from 'node:test';
import assert from 'node:assert/strict';
import {mappingReport} from '../src/seat-mapping-report.js';
const db={prepare(sql){return {first:async()=>sql.includes('COUNT(*) AS total')?{total:3737,sections:63,mapped:0,unreleased:3737,blocked:0,available:0}:{count:0},bind(...args){this.args=args;return this},all:async()=>({results:[{sku:'WM-ST-105-B-06',section:'105',row_label:'B',seat_number:6,price_cents:10000,section_product_sku:'WM-105',shopify_variant_id:null,status:'UNRELEASED'}]})}}};
test('mapping report stays read-only and disables sales',async()=>{const r=await mappingReport(new Request('https://x/api/seats/admin/mapping-report?page=2&size=50'),{SEAT_DB:db});assert.equal(r.status,200);const b=await r.json();assert.equal(b.sales_enabled,false);assert.equal(b.checkout_enabled,false);assert.equal(b.inventory.total,3737);assert.equal(b.seats[0].sku,'WM-ST-105-B-06');});
test('mapping report rejects unreasonable page sizes',async()=>{const r=await mappingReport(new Request('https://x/api/seats/admin/mapping-report?size=100000'),{SEAT_DB:db});assert.equal(r.status,400)});
test('mapping report rejects non-GET',async()=>{const r=await mappingReport(new Request('https://x/api/seats/admin/mapping-report',{method:'POST'}),{SEAT_DB:db});assert.equal(r.status,405)});
