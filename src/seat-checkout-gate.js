/** V88: fail-closed, read-only checkout diagnostics. NOT permission to sell tickets. */
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const inactive={mode:'STAGING_READ_ONLY',sales_enabled:false,checkout_enabled:false,holds_enabled:false,authorization_granted:false};
export function evaluateCheckoutReadiness(rows,{approvedManifest=false,checkoutConfigured=false,webhookConfigured=false}={}){
 if(!Array.isArray(rows)||rows.length===0||rows.length>8)throw Error('INVALID_SEAT_SET');
 const issues=[];const seen=new Set();const variants=new Set();let totalCents=0;
 for(const row of rows){
  if(!row||typeof row.sku!=='string'||!SKU.test(row.sku))throw Error('INVALID_SEAT_SKU');
  if(seen.has(row.sku))throw Error('DUPLICATE_SEAT_SKU');seen.add(row.sku);
  if(row.status!=='AVAILABLE')issues.push({sku:row.sku,reason:'NOT_AVAILABLE'});
  if(row.hold_id||row.shopify_order_id)issues.push({sku:row.sku,reason:'ALREADY_CLAIMED'});
  if(typeof row.shopify_variant_id!=='string'||!GID.test(row.shopify_variant_id))issues.push({sku:row.sku,reason:'UNMAPPED_VARIANT'});
  else if(variants.has(row.shopify_variant_id))issues.push({sku:row.sku,reason:'DUPLICATE_SHOPIFY_VARIANT'});
  else variants.add(row.shopify_variant_id);
  if(!Number.isSafeInteger(row.price_cents)||row.price_cents<=0)issues.push({sku:row.sku,reason:'INVALID_PRICE'});
  else if(!Number.isSafeInteger(totalCents+row.price_cents))issues.push({sku:row.sku,reason:'PRICE_TOTAL_OVERFLOW'});
  else totalCents+=row.price_cents;
 }
 if(approvedManifest!==true)issues.push({reason:'VENUE_MANIFEST_NOT_APPROVED'});
 if(checkoutConfigured!==true)issues.push({reason:'CHECKOUT_NOT_CONFIGURED'});
 if(webhookConfigured!==true)issues.push({reason:'PAYMENT_FULFILLMENT_NOT_CONFIGURED'});
 return {...inactive,ready:issues.length===0,issues,seat_count:rows.length,total_cents:issues.length?null:totalCents};
}
export async function inspectCheckoutGate(db,skus,options={}){
 if(!Array.isArray(skus)||skus.length<1||skus.length>8||skus.some(s=>typeof s!=='string'||!SKU.test(s))||new Set(skus).size!==skus.length)throw Error('INVALID_SELECTION');
 if(!db?.prepare)throw Error('DATABASE_UNAVAILABLE');
 const result=await db.prepare(`SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku IN (${skus.map(()=>'?').join(',')})`).bind(...skus).all();
 if(!Array.isArray(result?.results))throw Error('DATABASE_RESULT_INVALID');
 const map=new Map();const duplicates=new Set();
 for(const row of result.results){
  if(!row||typeof row.sku!=='string'||!skus.includes(row.sku))throw Error('DATABASE_RESULT_INVALID');
  if(map.has(row.sku))duplicates.add(row.sku);
  map.set(row.sku,row);
 }
 if(duplicates.size)return {...inactive,ready:false,issues:[...duplicates].map(sku=>({sku,reason:'DUPLICATE_DATABASE_SEAT'})),seat_count:skus.length,total_cents:null};
 const missing=skus.filter(s=>!map.has(s));
 if(missing.length)return {...inactive,ready:false,issues:missing.map(sku=>({sku,reason:'NOT_FOUND'})),seat_count:skus.length,total_cents:null};
 return evaluateCheckoutReadiness(skus.map(s=>map.get(s)),options);
}
