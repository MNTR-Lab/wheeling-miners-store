/** V87 fail-closed checkout readiness gate. Never changes seat inventory. */
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/\d+$/;
export function evaluateCheckoutReadiness(rows,{approvedManifest=false,checkoutConfigured=false,webhookConfigured=false}={}){
 if(!Array.isArray(rows)||rows.length===0||rows.length>8)throw Error('INVALID_SEAT_SET');
 const issues=[];const seen=new Set();let totalCents=0;
 for(const row of rows){
  if(!row||typeof row.sku!=='string'||!SKU.test(row.sku))throw Error('INVALID_SEAT_SKU');
  if(seen.has(row.sku))throw Error('DUPLICATE_SEAT_SKU');seen.add(row.sku);
  if(row.status!=='AVAILABLE')issues.push({sku:row.sku,reason:'NOT_AVAILABLE'});
  if(row.hold_id||row.shopify_order_id)issues.push({sku:row.sku,reason:'ALREADY_CLAIMED'});
  if(!GID.test(row.shopify_variant_id??''))issues.push({sku:row.sku,reason:'UNMAPPED_VARIANT'});
  if(!Number.isSafeInteger(row.price_cents)||row.price_cents<=0)issues.push({sku:row.sku,reason:'INVALID_PRICE'});
  else totalCents+=row.price_cents;
 }
 if(!approvedManifest)issues.push({reason:'VENUE_MANIFEST_NOT_APPROVED'});
 if(!checkoutConfigured)issues.push({reason:'CHECKOUT_NOT_CONFIGURED'});
 if(!webhookConfigured)issues.push({reason:'PAYMENT_FULFILLMENT_NOT_CONFIGURED'});
 return {mode:'STAGING_READ_ONLY',ready:issues.length===0,issues,seat_count:rows.length,total_cents:issues.length?null:totalCents};
}
export async function inspectCheckoutGate(db,skus,options={}){
 if(!Array.isArray(skus)||skus.length<1||skus.length>8||skus.some(s=>typeof s!=='string'||!SKU.test(s))||new Set(skus).size!==skus.length)throw Error('INVALID_SELECTION');
 if(!db?.prepare)throw Error('DATABASE_UNAVAILABLE');
 const result=await db.prepare(`SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
 const map=new Map((result.results||[]).map(r=>[r.sku,r]));
 const missing=skus.filter(s=>!map.has(s));
 if(missing.length)return {mode:'STAGING_READ_ONLY',ready:false,issues:missing.map(sku=>({sku,reason:'NOT_FOUND'})),seat_count:skus.length,total_cents:null};
 return evaluateCheckoutReadiness(skus.map(s=>map.get(s)),options);
}
