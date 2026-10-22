/** V91: fail-closed paid Shopify seat order parsing and reconciliation.
 * Pure functions only. No D1 writes, webhook acknowledgements or sales activation.
 */
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/([1-9]\d*)$/;
const ID=/^[1-9]\d*$/;
const fail=code=>{throw Error(code)};
export function parsePaidSeatOrder(order,{maxSeats=8}={}){
 if(!order||!ID.test(String(order.id??''))||!Array.isArray(order.line_items))fail('INVALID_ORDER');
 if(!Number.isSafeInteger(maxSeats)||maxSeats<1||maxSeats>8)fail('INVALID_SEAT_LIMIT');
 const lines=order.line_items.filter(x=>typeof x?.sku==='string'&&SKU.test(x.sku));
 if(!lines.length)return {ignored:true,orderId:String(order.id),seats:[]};
 if(lines.length>maxSeats)fail('TOO_MANY_SEATS');
 if(new Set(lines.map(x=>x.sku)).size!==lines.length)fail('DUPLICATE_SEAT_SKU');
 const variants=new Set();
 const seats=lines.map(x=>{
  const id=String(x.variant_id??'');
  if(x.quantity!==1||!ID.test(id))fail('INVALID_LINE_ITEM');
  if(variants.has(id))fail('DUPLICATE_PAID_VARIANT');
  variants.add(id);
  return {sku:x.sku,variantId:id};
 });
 return {ignored:false,orderId:String(order.id),seats};
}
export function reconcilePaidSeats(parsed,records){
 if(!parsed||!Array.isArray(parsed.seats)||!ID.test(String(parsed.orderId??'')))fail('INVALID_PARSED_ORDER');
 if(parsed.ignored)return {ready:false,ignored:true,issues:[]};
 if(!parsed.seats.length||parsed.seats.length>8)fail('INVALID_PARSED_SEATS');
 if(!Array.isArray(records))fail('INVALID_DB_RECORDS');
 const expected=new Set(parsed.seats.map(x=>x.sku));
 if(expected.size!==parsed.seats.length)fail('DUPLICATE_SEAT_SKU');
 const map=new Map();
 for(const r of records){
  if(!r||typeof r.sku!=='string'||!expected.has(r.sku))fail('UNEXPECTED_DB_SKU');
  if(map.has(r.sku))fail('DUPLICATE_DB_SKU');
  map.set(r.sku,r);
 }
 const issues=[];let replay=0;
 for(const s of parsed.seats){
  if(!s||typeof s.sku!=='string'||!ID.test(String(s.variantId??'')))fail('INVALID_PARSED_SEATS');
  const row=map.get(s.sku);if(!row){issues.push({sku:s.sku,reason:'UNKNOWN_SEAT'});continue;}
  const variant=GID.exec(row.shopify_variant_id??'');
  if(!variant||variant[1]!==s.variantId){issues.push({sku:s.sku,reason:'VARIANT_MISMATCH'});continue;}
  if(row.status==='SOLD'&&String(row.shopify_order_id)===parsed.orderId){replay++;continue;}
  if(row.shopify_order_id||row.status!=='HELD')issues.push({sku:s.sku,reason:'NOT_HELD_FOR_PAYMENT'});
 }
 if(replay&&replay!==parsed.seats.length)issues.push({reason:'PARTIAL_REPLAY'});
 return {ready:issues.length===0&&replay===0,replayed:issues.length===0&&replay===parsed.seats.length,issues,seatCount:parsed.seats.length};
}
/** Generates guarded SQL only; no execution or sale authorization. */
export function paidOrderSqlPlan(parsed,{reservationId}={}){
 if(!parsed||parsed.ignored||!Array.isArray(parsed.seats)||!parsed.seats.length||parsed.seats.length>8||!ID.test(String(parsed.orderId??'')))fail('NO_SEATS');
 if(typeof reservationId!=='string'||!/^[-_a-zA-Z0-9]{16,128}$/.test(reservationId))fail('INVALID_RESERVATION');
 const skus=new Set(),variants=new Set();
 return parsed.seats.map(s=>{
  if(!s||typeof s.sku!=='string'||!SKU.test(s.sku)||!ID.test(String(s.variantId??'')))fail('INVALID_LINE_ITEM');
  if(skus.has(s.sku))fail('DUPLICATE_SEAT_SKU');
  if(variants.has(s.variantId))fail('DUPLICATE_PAID_VARIANT');
  skus.add(s.sku);variants.add(s.variantId);
  return {sql:"UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_variant_id=? AND shopify_order_id IS NULL",params:[parsed.orderId,s.sku,reservationId,`gid://shopify/ProductVariant/${s.variantId}`],expectedChanges:1};
 });
}
