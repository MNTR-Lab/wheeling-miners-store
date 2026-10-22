/** V71: Read-only catalog readiness audit; never writes to D1 or Shopify. */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
export function auditSection(row){
 const issues=[];
 if(!/^\d{3}$/.test(String(row.section)))issues.push('INVALID_SECTION');
 if(Number(row.seats)<1||Number(row.seats)>2048)issues.push('VARIANT_LIMIT');
 if(Number(row.product_skus)!==1)issues.push('PRODUCT_SKU_CONFLICT');
 if(Number(row.price_tiers)!==1)issues.push('PRICE_TIER_CONFLICT');
 if(Number(row.invalid_skus)>0)issues.push('INVALID_SEAT_SKUS');
 if(Number(row.mapped)>0&&Number(row.mapped)!==Number(row.seats))issues.push('PARTIAL_MAPPING');
 if(Number(row.active)>0)issues.push('SEATS_NOT_STAGED');
 return {section:row.section,seats:row.seats,section_product_sku:row.section_product_sku,price_cents:row.price_cents,mapped:row.mapped,issues,ready_for_draft_variant_creation:issues.length===0&&Number(row.mapped)===0};
}
export async function seatCatalogAudit(request,env){
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const result=await env.SEAT_DB.prepare(`SELECT section,COUNT(*) AS seats,MIN(section_product_sku) AS section_product_sku,MIN(price_cents) AS price_cents,COUNT(DISTINCT price_cents) AS price_tiers,COUNT(DISTINCT section_product_sku) AS product_skus,SUM(CASE WHEN sku NOT GLOB 'WM-ST-[0-9][0-9][0-9]-*' THEN 1 ELSE 0 END) AS invalid_skus,SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,SUM(CASE WHEN status NOT IN ('UNRELEASED','BLOCKED') THEN 1 ELSE 0 END) AS active FROM seats GROUP BY section ORDER BY section`).all();
 const sections=result.results.map(auditSection);
 const totals={sections:sections.length,seats:sections.reduce((n,s)=>n+Number(s.seats),0),mapped:sections.reduce((n,s)=>n+Number(s.mapped),0),eligible_draft_sections:sections.filter(s=>s.ready_for_draft_variant_creation).length};
 const blockers=[];
 if(totals.sections!==63)blockers.push('EXPECTED_63_SECTIONS');
 if(totals.seats!==3737)blockers.push('EXPECTED_3737_SEATS');
 if(sections.some(s=>s.issues.length))blockers.push('SECTION_AUDIT_ISSUES');
 blockers.push('SHOPIFY_PRODUCT_IDS_AND_PRICES_MUST_BE_VERIFIED');
 blockers.push('PAYMENT_CHECKOUT_AND_FULFILLMENT_NOT_ENABLED');
 return reply({mode:'ADMIN_STAGING',ticket_type:'FULL_SEASON',shopify_write_enabled:false,sales_enabled:false,ready_for_sales:false,totals,sections,blockers});
}
