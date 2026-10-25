/** Read-only catalog audit using only columns present in TEST D1.
 * SOLD tickets are immutable historical records, not seats available for release.
 */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
export function auditSection(row){
 const issues=[];
 const section=String(row.section);
 if(!/^\d{3}$/.test(section))issues.push('INVALID_SECTION');
 if(Number(row.seats)<1||Number(row.seats)>2048)issues.push('VARIANT_LIMIT');
 const fixtureCount=Number(row.sold_test_fixtures||0);
 const priceTiers=Number(row.price_tiers);
 // Only section 105 contains two verified historical $1 test sales.
 if(priceTiers!==1&&!(section==='105'&&fixtureCount===2&&priceTiers===2))issues.push('PRICE_TIER_CONFLICT');
 if(Number(row.invalid_skus)>0)issues.push('INVALID_SEAT_SKUS');
 if(Number(row.mapped)>0&&Number(row.mapped)!==Number(row.seats))issues.push('PARTIAL_MAPPING');
 // AVAILABLE/HELD seats are not staged. SOLD records must never be treated as release candidates.
 if(Number(row.active)>0)issues.push('SEATS_NOT_STAGED');
 if(Number(row.sold||0)!==fixtureCount)issues.push('UNEXPECTED_SOLD_SEATS');
 if(fixtureCount>0&&section!=='105')issues.push('UNEXPECTED_TEST_FIXTURES');
 return {section,seats:row.seats,section_product_sku:'WM-ST-SEC-'+section,price_cents:row.price_cents,mapped:row.mapped,sold:row.sold||0,sold_test_fixtures:fixtureCount,issues,ready_for_draft_variant_creation:issues.length===0&&Number(row.mapped)===0};
}
export async function seatCatalogAudit(request,env){
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const result=await env.SEAT_DB.prepare(`SELECT section,COUNT(*) AS seats,
 MIN(CASE WHEN status!='SOLD' THEN price_cents END) AS price_cents,
 COUNT(DISTINCT price_cents) AS price_tiers,
 SUM(CASE WHEN sku NOT GLOB 'WM-ST-[0-9][0-9][0-9]-*' THEN 1 ELSE 0 END) AS invalid_skus,
 SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped,
 SUM(CASE WHEN status IN ('AVAILABLE','HELD') THEN 1 ELSE 0 END) AS active,
 SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold,
 SUM(CASE WHEN status='SOLD' AND price_cents=100 AND sku IN ('WM-ST-105-B-01','WM-ST-105-B-02') THEN 1 ELSE 0 END) AS sold_test_fixtures
 FROM seats GROUP BY section ORDER BY section`).all();
 const sections=result.results.map(auditSection);
 const totals={sections:sections.length,seats:sections.reduce((n,s)=>n+Number(s.seats),0),mapped:sections.reduce((n,s)=>n+Number(s.mapped),0),eligible_draft_sections:sections.filter(s=>s.ready_for_draft_variant_creation).length};
 const blockers=[];
 if(totals.sections!==63)blockers.push('EXPECTED_63_SECTIONS');
 if(totals.seats!==3737)blockers.push('EXPECTED_3737_SEATS');
 if(sections.some(s=>s.issues.length))blockers.push('SECTION_AUDIT_ISSUES');
 blockers.push('TEST_SOLD_FIXTURES_MUST_NOT_BE_RELEASED');
 blockers.push('PUBLIC_CHECKOUT_AND_SEAT_RELEASE_NOT_ENABLED');
 return reply({mode:'ADMIN_STAGING',ticket_type:'FULL_SEASON',shopify_write_enabled:false,sales_enabled:false,ready_for_sales:false,totals,sections,blockers});
}
