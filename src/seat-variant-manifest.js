/** Read-only Shopify variant manifest. Does not create, publish or release inventory. */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
export function formatVariant(row){
 if(!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(row.sku))throw Error('Invalid seat SKU');
 if(!Number.isSafeInteger(row.price_cents)||row.price_cents<=0)throw Error('Invalid seat price');
 if(row.status!=='UNRELEASED'&&row.status!=='BLOCKED')throw Error('Seat not in safe staging state');
 return {sku:row.sku,section:row.section,section_product_sku:row.section_product_sku,
  option_name:'Assigned Seat',option_value:`Row ${row.row_label} / Seat ${row.seat_number}`,
  price:(row.price_cents/100).toFixed(2),inventory_policy:'DENY',inventory_tracking_required:true,
  initial_inventory_quantity:0,requires_shipping:false,shopify_variant_id:row.shopify_variant_id||null,
  current_seat_status:row.status};
}
export async function seatVariantManifest(request,env){
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 const u=new URL(request.url),section=u.searchParams.get('section');
 if(!section||!/^\d{3}$/.test(section))return json({error:'A three-digit section is required'},400);
 const page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('size')||100);
 if(!Number.isSafeInteger(page)||page<1||page>1000||!Number.isSafeInteger(size)||size<1||size>100)return json({error:'Invalid pagination'},400);
 const stats=await env.SEAT_DB.prepare(`SELECT COUNT(*) AS count,1 AS products,COUNT(DISTINCT price_cents) AS price_tiers,
 MIN(price_cents) AS min_price_cents,MAX(price_cents) AS max_price_cents FROM seats WHERE section=?`).bind(section).first();
 if(!stats?.count)return json({error:'Unknown section'},404);
 const result=await env.SEAT_DB.prepare(`SELECT sku,section,row_label,seat_number,price_cents,
 ('WM-ST-SEC-' || section) AS section_product_sku,shopify_variant_id,status
 FROM seats WHERE section=? AND status IN ('UNRELEASED','BLOCKED') ORDER BY row_label,seat_number LIMIT ? OFFSET ?`).bind(section,size,(page-1)*size).all();
 let variants;try{variants=result.results.map(formatVariant);}catch(e){return json({error:'Unsafe source inventory',detail:e.message},409);}
 const eligible=await env.SEAT_DB.prepare("SELECT COUNT(*) AS count FROM seats WHERE section=? AND status IN ('UNRELEASED','BLOCKED')").bind(section).first();
 return json({mode:'ADMIN_STAGING',ticket_type:'FULL_SEASON',sales_enabled:false,shopify_write_enabled:false,
  section,page,size,total_pages:Math.ceil((eligible?.count||0)/size),stats:{...stats,eligible_seats:eligible?.count||0},variants,
  warnings:['Planning data only; no Shopify products are created.','Previously SOLD test fixtures are intentionally excluded.','Draft products must remain unpublished and have zero sellable inventory.']});
}
