import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBatches} from '../tools/build-season-variant-batches.mjs';
function fixture(){let remaining=3737;const sections=Array.from({length:63},(_,i)=>{const section=String(i+101).padStart(3,'0');const count=Math.min(60,remaining);remaining-=count;return {section,productId:`gid://shopify/Product/${i+1}`,existing_variant_count:1,proposed_variants:Array.from({length:count},(_,j)=>{const seat=String(j+1).padStart(2,'0');const sku=`WM-ST-${section}-A-${seat}`;return {sku,price:'175.00',inventoryPolicy:'DENY',inventoryItem:{sku,tracked:true},optionValues:[{optionName:'Row',name:'A'},{optionName:'Seat',name:String(j+1)}]};})};});return {ready_to_generate_payloads:true,mode:'OFFLINE_PLAN_ONLY',sales_enabled:false,seat_count:3737,section_count:63,sections};}
test('produces only offline Shopify requests for 3,737 seats',()=>{const r=buildBatches(fixture());assert.equal(r.seat_count,3737);assert.equal(r.executed,false);assert.equal(r.shopify_writes,0);assert.equal(r.d1_writes,0);assert.ok(r.batches.every(x=>x.request.variables.variants.length<=50));});
test('refuses unapproved plan',()=>{const p=fixture();p.ready_to_generate_payloads=false;assert.throws(()=>buildBatches(p),/Independent approval/);});
test('refuses duplicate SKUs',()=>{const p=fixture();p.sections[1].proposed_variants[0].sku=p.sections[0].proposed_variants[0].sku;assert.throws(()=>buildBatches(p));});
test('refuses unsafe inventory policies',()=>{const p=fixture();p.sections[0].proposed_variants[0].inventoryPolicy='CONTINUE';assert.throws(()=>buildBatches(p),/Unsafe inventory/);});
test('refuses missing seats',()=>{const p=fixture();p.sections[0].proposed_variants.pop();assert.throws(()=>buildBatches(p),/Incomplete/);});
