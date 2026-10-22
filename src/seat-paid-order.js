/** V79: pure validation and guarded SQL planning for paid Shopify seat orders.
 * Does not execute D1 writes, change inventory, or enable webhook fulfillment.
 */
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/(\d+)$/;
export function parsePaidSeatOrder(order,{maxSeats=8}={}){
 if(!order||!/^\d+$/.test(String(order.id??''))||!Array.isArray(order.line_items))throw Error('INVALID_ORDER');
 const lines=order.line_items.filter(x=>typeof x?.sku==='string'&&SKU.test(x.sku));
 if(!lines.length)return {ignored:true,orderId:String(order.id),seats:[]};
 if(lines.length>maxSeats)throw Error('TOO_MANY_SEATS');
 if(new Set(lines.map(x=>x.sku)).size!==lines.length)throw Error('DUPLICATE_SEAT_SKU');
 const seats=lines.map(x=>{
  if(x.quantity!==1||!/^\d+$/.test(String(x.variant_id??'')))throw Error('INVALID_LINE_ITEM');
  return {sku:x.sku,variantId:String(x.variant_id)};
 });
 return {ignored:false,orderId:String(order.id),seats};
}
export function reconcilePaidSeats(parsed,records){
 if(parsed.ignored)return {ready:false,ignored:true,issues:[]};
 if(!Array.isArray(records))throw Error('INVALID_DB_RECORDS');
 const map=new Map();for(const r of records){if(map.has(r.sku))throw Error('DUPLICATE_DB_SKU');map.set(r.sku,r);}
 const issues=[];let replay=0;
 for(const s of parsed.seats){
  const row=map.get(s.sku);if(!row){issues.push({sku:s.sku,reason:'UNKNOWN_SEAT'});continue;}
  const variant=GID.exec(row.shopify_variant_id??'');
  if(!variant||variant[1]!==s.variantId){issues.push({sku:s.sku,reason:'VARIANT_MISMATCH'});continue;}
  if(row.status==='SOLD'&&String(row.shopify_order_id)===parsed.orderId){replay++;continue;}
  if(row.shopify_order_id||row.status!=='HELD')issues.push({sku:s.sku,reason:'NOT_HELD_FOR_PAYMENT'});
 }
 if(replay&&replay!==parsed.seats.length)issues.push({reason:'PARTIAL_REPLAY'});
 return {ready:issues.length===0&&replay===0,replayed:issues.length===0&&replay===parsed.seats.length,issues,seatCount:parsed.seats.length};
}
/** Transactional SQL for future integration. D1 writes are deliberately NOT called here.
 * Must be executed with transaction/guard checks and a reservation ownership match.
 */
export function paidOrderSqlPlan(parsed,{reservationId}={}){
 if(parsed.ignored||!parsed.seats.length)throw Error('NO_SEATS');
 if(typeof reservationId!=='string'||!/^[-_a-zA-Z0-9]{16,128}$/.test(reservationId))throw Error('INVALID_RESERVATION');
 return parsed.seats.map(s=>({
  sql:"UPDATE seats SET status='SOLD',shopify_order_id=?,hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_variant_id=? AND shopify_order_id IS NULL",
  params:[parsed.orderId,s.sku,reservationId,`gid://shopify/ProductVariant/${s.variantId}`],
  expectedChanges:1
 }));
}
