/** Read-only Shopify mapping report compatible with the live TEST D1 seats schema. */
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export async function mappingReport(request,env){
 const url=new URL(request.url);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('size')||100);
 if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(size)||size<1||size>250)return json({error:'Invalid pagination; page >= 1 and size 1–250'},400);
 const stats=await env.SEAT_DB.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT section) AS sections,
 SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,
 SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,
 SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked,
 SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
 SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold FROM seats`).first();
 const duplicates=await env.SEAT_DB.prepare("SELECT COUNT(*) AS count FROM (SELECT shopify_variant_id FROM seats WHERE shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' GROUP BY shopify_variant_id HAVING COUNT(*)>1)").first();
 const seats=await env.SEAT_DB.prepare(`SELECT sku,section,row_label,seat_number,price_cents,
 ('WM-ST-SEC-' || section) AS section_product_sku,shopify_variant_id,status
 FROM seats ORDER BY section,row_label,seat_number LIMIT ? OFFSET ?`).bind(size,(page-1)*size).all();
 return json({mode:'ADMIN_STAGING',sales_enabled:false,checkout_enabled:false,report:'SHOPIFY_SEAT_MAPPING',page,size,total_pages:Math.ceil((stats?.total||0)/size),inventory:{...stats,duplicate_variant_ids:duplicates?.count||0},seats:seats.results,notes:['Read-only report; no Shopify products or variants are created.','Section product SKU is derived from the approved section number; no schema migration required.','Existing SOLD test seats are retained as test fixtures and must not be released for sale.']});
}
