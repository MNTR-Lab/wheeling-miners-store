/** Fail-closed validation before any controlled test checkout creates a reservation. */
import assert from 'node:assert/strict';
export function validateTestCheckoutSeat(seat,{sku,variant}={}){
 assert.match(sku||'',/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/);
 assert.match(variant||'',/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
 assert.ok(!['WM-ST-105-B-01','WM-ST-105-B-02'].includes(sku),'Historical SOLD fixtures are not reusable test inventory');
 assert.equal(seat?.sku,sku,'Wrong seat');
 assert.equal(seat?.status,'UNRELEASED','Test seat must be unreleased');
 assert.equal(seat?.hold_id,null,'Seat has existing hold');
 assert.equal(seat?.shopify_order_id,null,'Seat belongs to an order');
 assert.equal(seat?.shopify_variant_id,variant,'Variant mapping mismatch');
 assert.ok(Number.isSafeInteger(seat?.price_cents)&&seat.price_cents>100,'Must use approved non-$1 ticket price');
 return true;
}
