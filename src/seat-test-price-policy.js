/** Narrow, TEST-only exception for the isolated $1 checkout fixture. */
export const TEST_SKU='WM-ST-105-B-03';
export const TEST_VARIANT='gid://shopify/ProductVariant/50944696418361';
export const TEST_SHOP='wheeling-miners-ticket-testing.myshopify.com';
export function isApprovedDollarTestSeat(seat,env){
 return env?.WM_ENVIRONMENT==='TEST' && env?.SHOPIFY_STORE_DOMAIN===TEST_SHOP &&
   seat?.sku===TEST_SKU && seat?.price_cents===100 && seat?.shopify_variant_id===TEST_VARIANT &&
   seat?.shopify_order_id==null && seat?.hold_id==null;
}
export function isApprovedTestReleasePrice(seat,env){
 return Number.isSafeInteger(seat?.price_cents) &&
  (seat.price_cents>100 || isApprovedDollarTestSeat(seat,env));
}
