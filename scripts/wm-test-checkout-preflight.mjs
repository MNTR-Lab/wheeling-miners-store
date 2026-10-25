/** Pure, fail-closed eligibility checks for a TEST-only checkout candidate. */
import assert from 'node:assert/strict';
export function validateTestCheckoutSeat(seat,{sku,variant}={}){
 assert.match(sku||'',/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/);
 assert.match(variant||'',/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
 assert.ok(!['WM-ST-105-B-01','WM-ST-105-B-02'].includes(sku),'SOLD fixtures cannot be reused');
 assert.equal(seat?.sku,sku);
 assert.equal(seat?.status,'UNRELEASED');
 assert.equal(seat?.hold_id,null);
 assert.equal(seat?.shopify_order_id,null);
 assert.equal(seat?.shopify_variant_id,variant);
 assert.ok(Number.isSafeInteger(seat?.price_cents)&&seat.price_cents>100);
 return true;
}
