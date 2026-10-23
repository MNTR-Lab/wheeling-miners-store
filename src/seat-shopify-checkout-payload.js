/** V117: read-only, server-owned Shopify checkout payload.
 * Production D1 expiry columns are integer epoch milliseconds.
 * Does not enable checkout, call Shopify, or mutate inventory.
 */
import {expiryMilliseconds} from './seat-expiry.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const NONCE=/^[A-Za-z0-9_-]{24,128}$/;
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/([1-9]\d*)$/;
const fail=code=>{throw Error(code)};
export function buildShopifySeatCheckout(reservation,linkedSeats,{now=new Date()}={}){
 if(!reservation||typeof reservation.id!=='string'||!RID.test(reservation.id))fail('INVALID_RESERVATION');
 if(typeof reservation.checkout_nonce!=='string'||!NONCE.test(reservation.checkout_nonce))fail('INVALID_CHECKOUT_NONCE');
 if(!['HELD','CHECKOUT_PENDING'].includes(reservation.status))fail('INVALID_RESERVATION_STATUS');
 if(reservation.shopify_order_id!=null)fail('RESERVATION_ALREADY_ORDERED');
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 let expiry;
 try{expiry=expiryMilliseconds(reservation.expires_at)}catch{fail('INVALID_RESERVATION_EXPIRY')}
 if(!Number.isSafeInteger(expiry)||expiry<=now.valueOf())fail('RESERVATION_EXPIRED');
 if(!Array.isArray(linkedSeats)||linkedSeats.length<1||linkedSeats.length>8)fail('INVALID_SEAT_SET');
 const skus=new Set(),variants=new Set(),lines=[];
 for(const row of linkedSeats){
  const sku=row?.seat_sku??row?.sku;
  if(typeof sku!=='string'||!SKU.test(sku))fail('INVALID_SEAT_SKU');
  if(skus.has(sku))fail('DUPLICATE_SEAT_SKU');skus.add(sku);
  const match=GID.exec(row?.shopify_variant_id??'');
  if(!match)fail('UNMAPPED_VARIANT');
  if(variants.has(match[1]))fail('DUPLICATE_SHOPIFY_VARIANT');variants.add(match[1]);
  lines.push({sku,variantId:match[1],merchandiseId:row.shopify_variant_id,quantity:1});
 }
 lines.sort((a,b)=>a.sku.localeCompare(b.sku));
 return {
  reservationId:reservation.id,
  expiresAt:expiry,
  seatCount:lines.length,
  lines,
  noteAttributes:[
   {name:'wm_reservation_id',value:reservation.id},
   {name:'wm_checkout_nonce',value:reservation.checkout_nonce}
  ],
  checkoutEnabled:false,
  paymentVerified:false,
  mode:'STAGING_PAYLOAD_ONLY'
 };
}
