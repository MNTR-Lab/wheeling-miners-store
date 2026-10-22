import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonTicketPlan} from '../src/season-ticket-plan.js';
const fake={SEAT_DB:{prepare:()=>({all:async()=>({results:[{section:'105',seats:6,min_price_cents:17500,max_price_cents:17500,price_tiers:1,product_skus:1,mapped:0,unreleased:6,blocked:0}]})})}};
test('season plan stays read-only and not ready for sales',async()=>{const r=await seasonTicketPlan(new Request('https://example.test/api/seats/admin/season-plan'),fake);const data=await r.json();assert.equal(r.status,200);assert.equal(data.sales_enabled,false);assert.equal(data.ready_for_sales,false);assert.equal(data.ticket_type,'ASSIGNED_SEAT_FULL_SEASON');assert.equal(data.sections[0].variant_strategy,'ONE_UNIQUE_VARIANT_PER_SEAT');});
test('season plan rejects writes',async()=>{const r=await seasonTicketPlan(new Request('https://example.test/api/seats/admin/season-plan',{method:'POST'}),fake);assert.equal(r.status,405);});
