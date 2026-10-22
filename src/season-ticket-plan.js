/** V69: Read-only season-ticket catalog plan. Does not create products, map variants, or release inventory. */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
export async function seasonTicketPlan(request,env){
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const rows=await env.SEAT_DB.prepare(`SELECT section,COUNT(*) AS seats,MIN(price_cents) AS min_price_cents,MAX(price_cents) AS max_price_cents,COUNT(DISTINCT price_cents) AS price_tiers,COUNT(DISTINCT section_product_sku) AS product_skus,SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked FROM seats GROUP BY section ORDER BY section`).all();
 const sections=rows.results.map(r=>({...r,product_strategy:'ONE_DRAFT_PRODUCT_PER_SECTION',variant_strategy:'ONE_UNIQUE_VARIANT_PER_SEAT',ticket_type:'FULL_SEASON',requires_price_approval:true}));
 const total=sections.reduce((n,r)=>n+r.seats,0);
 const mapped=sections.reduce((n,r)=>n+r.mapped,0);
 const blockers=[];
 if(total!==3737)blockers.push('Unexpected seat count');
 if(sections.length!==63)blockers.push('Unexpected section count');
 if(sections.some(s=>s.product_skus!==1))blockers.push('Section contains inconsistent product SKU values');
 if(sections.some(s=>s.price_tiers!==1))blockers.push('Section contains multiple price tiers; approve pricing before creating variants');
 if(mapped!==total)blockers.push('Unique Shopify seat variants are not mapped');
 blockers.push('Season-ticket prices and included home games require business approval');
 blockers.push('Checkout, atomic seat holds, webhook fulfillment and delivery remain disabled');
 return reply({mode:'ADMIN_STAGING',ticket_type:'ASSIGNED_SEAT_FULL_SEASON',sales_enabled:false,ready_for_sales:false,totals:{seats:total,sections:sections.length,mapped},sections,blockers});
}
