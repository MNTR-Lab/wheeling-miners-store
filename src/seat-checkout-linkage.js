/** V84: fail-closed checkout-to-reservation ownership validation.
 * Pure functions; does not create checkouts, alter D1, or enable sales.
 * Shopify checkout creation MUST persist a server-generated nonce and reservation ID.
 */
import {parsePaidSeatOrder} from './seat-paid-order.js';
const RID=/^[A-Za-z0-9_-]{16,128}$/;
const NONCE=/^[A-Za-z0-9_-]{24,128}$/;
const ORDER=/^\d+$/;
const VARN=/^gid:\/\/shopify\/ProductVariant\/(\d+)$/;
const fail=(reason)=>{throw new Error(reason)};
function extractAttributes(order){
 const out=new Map();
 if(!Array.isArray(order?.note_attributes))return out;
 for(const a of order.note_attributes){
  if(typeof a?.name!=='string'||typeof a?.value!=='string')continue;
  if(out.has(a.name))fail('DUPLICATE_CHECKOUT_ATTRIBUTE');
  out.set(a.name,a.value);
 }
 return out;
}
/** Reservation record must come from D1, never from a request payload. */
export function verifyCheckoutOwnership(order,reservation,reservationSeats,{now=new Date()}={}){
 const parsed=parsePaidSeatOrder(order);
 if(parsed.ignored)fail('NO_ASSIGNED_SEATS');
 if(!reservation||!RID.test(reservation.id??''))fail('INVALID_RESERVATION');
 if(!NONCE.test(reservation.checkout_nonce??''))fail('MISSING_SERVER_NONCE');
 if(!ORDER.test(parsed.orderId))fail('INVALID_ORDER');
 if(!['HELD','CHECKOUT_PENDING','PAID'].includes(reservation.status))fail('INVALID_RESERVATION_STATUS');
 if(reservation.shopify_order_id!=null&&String(reservation.shopify_order_id)!==parsed.orderId)fail('ORDER_MISMATCH');
 const attrs=extractAttributes(order);
 if(attrs.get('wm_reservation_id')!==reservation.id)fail('RESERVATION_LINK_MISMATCH');
 if(attrs.get('wm_checkout_nonce')!==reservation.checkout_nonce)fail('CHECKOUT_NONCE_MISMATCH');
 if(!Array.isArray(reservationSeats)||reservationSeats.length!==parsed.seats.length)fail('SEAT_COUNT_MISMATCH');
 const expected=new Map();
 for(const seat of reservationSeats){
  if(typeof seat?.sku!=='string'||expected.has(seat.sku))fail('DUPLICATE_RESERVATION_SEAT');
  const v=VARN.exec(seat.shopify_variant_id??'');if(!v)fail('UNMAPPED_RESERVATION_SEAT');
  expected.set(seat.sku,v[1]);
 }
 for(const seat of parsed.seats){if(expected.get(seat.sku)!==seat.variantId)fail('RESERVATION_SEAT_MISMATCH');}
 if(!(now instanceof Date)||Number.isNaN(now.valueOf()))fail('INVALID_CLOCK');
 // Expired holds are not automatically eligible for fulfillment: manual reconciliation
 // is required, even when payment succeeded, to avoid reallocating an expired seat.
 if(typeof reservation.expires_at!=='string'||!Number.isFinite(Date.parse(reservation.expires_at)))fail('MISSING_EXPIRY');
 if(Date.parse(reservation.expires_at)<now.getTime()&&reservation.status!=='PAID')fail('EXPIRED_RESERVATION');
 return {confirmedOwnership:true,reservationId:reservation.id,orderId:parsed.orderId,seatCount:parsed.seats.length};
}
