/** V112: strict read-only Shopify/D1 reservation ownership validation; never enables sales. */
import {parsePaidSeatOrder} from './seat-paid-order.js';
import {expiryMilliseconds} from './seat-expiry.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const NONCE=/^[A-Za-z0-9_-]{24,128}$/;
const ORDER=/^[1-9]\d*$/;
const VARIANT=/^gid:\/\/shopify\/ProductVariant\/([1-9]\d*)$/;
const fail=reason=>{throw Error(reason)};
function checkoutAttributes(order){
 const out=new Map();
 if(!Array.isArray(order?.note_attributes))return out;
 for(const a of order.note_attributes){
  if(typeof a?.name!=='string'||typeof a?.value!=='string')continue;
  if(out.has(a.name))fail('DUPLICATE_CHECKOUT_ATTRIBUTE');
  out.set(a.name,a.value);
 }
 return out;
}
/** reservation and reservationSeats must originate from trusted D1 reads. */
export function verifyCheckoutOwnership(order,reservation,reservationSeats,{now=new Date()}={}){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)fail('NO_ASSIGNED_SEATS');
 if(!reservation||typeof reservation.id!=='string'||!RID.test(reservation.id))fail('INVALID_RESERVATION');
 if(typeof reservation.checkout_nonce!=='string'||!NONCE.test(reservation.checkout_nonce))fail('MISSING_SERVER_NONCE');
 if(!ORDER.test(parsed.orderId))fail('INVALID_ORDER');
 if(!['HELD','CHECKOUT_PENDING','CONFIRMED'].includes(reservation.status))fail('INVALID_RESERVATION_STATUS');
 if(reservation.shopify_order_id!=null&&String(reservation.shopify_order_id)!==parsed.orderId)fail('ORDER_MISMATCH');
 const attrs=checkoutAttributes(order);
 if(attrs.get('wm_reservation_id')!==reservation.id)fail('RESERVATION_LINK_MISMATCH');
 if(attrs.get('wm_checkout_nonce')!==reservation.checkout_nonce)fail('CHECKOUT_NONCE_MISMATCH');
 if(!Array.isArray(reservationSeats)||reservationSeats.length!==parsed.seats.length)fail('SEAT_COUNT_MISMATCH');
 const expected=new Map(),variants=new Set();
 for(const seat of reservationSeats){
  if(typeof seat?.sku!=='string'||expected.has(seat.sku))fail('DUPLICATE_RESERVATION_SEAT');
  const match=VARIANT.exec(seat.shopify_variant_id??'');
  if(!match)fail('UNMAPPED_RESERVATION_SEAT');
  if(variants.has(match[1]))fail('DUPLICATE_RESERVATION_VARIANT');
  variants.add(match[1]);expected.set(seat.sku,match[1]);
 }
 const paidVariants=new Set();
 for(const seat of parsed.seats){
  if(paidVariants.has(seat.variantId))fail('DUPLICATE_PAID_VARIANT');
  paidVariants.add(seat.variantId);
  if(expected.get(seat.sku)!==seat.variantId)fail('RESERVATION_SEAT_MISMATCH');
 }
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('INVALID_CLOCK');
 let expiry;
 try{expiry=expiryMilliseconds(reservation.expires_at)}catch{fail('MISSING_EXPIRY')}
 if(expiry<now.getTime()&&reservation.status!=='CONFIRMED')fail('EXPIRED_RESERVATION');
 return {confirmedOwnership:true,reservationId:reservation.id,orderId:parsed.orderId,seatCount:parsed.seats.length};
}
