/** V122: conservative Shopify refund/cancellation reconciliation preview.
 * Pure read-only planning. Never restores sold seats or initiates refunds.
 * Any refund of assigned-seat tickets requires operator review.
 */
import {parsePaidSeatOrder} from './seat-paid-order.js';
const fail=code=>{throw Error(code)};
const POSITIVE=/^[1-9]\d*$/;
export function previewSeatRefund(order,refund,seatRows){
 const paid=parsePaidSeatOrder(order);
 if(paid.ignored)return {mode:'READ_ONLY',ignored:true,requiresManualReview:false,automaticSeatRelease:false,mutations:0};
 if(!refund||!Array.isArray(refund.refund_line_items))fail('INVALID_REFUND');
 if(!Array.isArray(seatRows))fail('INVALID_SEAT_RECORDS');
 const bySku=new Map();
 for(const row of seatRows){
  if(!row||typeof row.sku!=='string'||bySku.has(row.sku))fail('INVALID_SEAT_RECORDS');
  bySku.set(row.sku,row);
 }
 const paidByLine=new Map(),paidBySku=new Map();
 for(const item of order.line_items){
  if(!paid.seats.some(s=>s.sku===item.sku))continue;
  const id=String(item.id??'');
  if(!POSITIVE.test(id)||paidByLine.has(id))fail('INVALID_ORDER_LINE_ID');
  paidByLine.set(id,item.sku);paidBySku.set(item.sku,String(item.variant_id));
 }
 const affected=new Set(),issues=[];
 for(const item of refund.refund_line_items){
  const lineId=String(item?.line_item_id??'');
  if(!POSITIVE.test(lineId))fail('INVALID_REFUND_LINE');
  const sku=paidByLine.get(lineId);
  if(!sku)continue;
  if(!Number.isSafeInteger(item.quantity)||item.quantity!==1)fail('INVALID_REFUND_QUANTITY');
  if(affected.has(sku))fail('DUPLICATE_REFUND_SEAT');
  affected.add(sku);
  const row=bySku.get(sku);
  if(!row){issues.push({sku,reason:'SEAT_RECORD_MISSING'});continue;}
  if(row.status!=='SOLD'||String(row.shopify_order_id??'')!==paid.orderId)issues.push({sku,reason:'SALE_OWNERSHIP_MISMATCH'});
  if(row.shopify_variant_id!==`gid://shopify/ProductVariant/${paidBySku.get(sku)}`)issues.push({sku,reason:'VARIANT_MISMATCH'});
 }
 if(!affected.size)return {mode:'READ_ONLY',ignored:true,requiresManualReview:false,automaticSeatRelease:false,mutations:0};
 return {mode:'READ_ONLY',ignored:false,orderId:paid.orderId,seatCount:affected.size,seatSkus:[...affected].sort(),issues,
  requiresManualReview:true,automaticSeatRelease:false,automaticRefund:false,mutations:0,
  nextAction:'MANUAL_REFUND_AND_SEAT_REASSIGNMENT_REVIEW'};
}
