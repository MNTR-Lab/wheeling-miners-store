/** Explicitly gated, admin-authenticated TEST-only release of one isolated seat.
 * Not wired into public checkout; production and historical SOLD fixtures are rejected.
 */
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
export function validateTestRelease(body,env){
 if(env?.WM_ENVIRONMENT!=='TEST'||env?.SEAT_TEST_RELEASE_ENABLED!=='true'||env?.SHOPIFY_STORE_DOMAIN!=='wheeling-miners-ticket-testing.myshopify.com')throw Error('TEST_RELEASE_DISABLED');
 if(!body||Object.keys(body).sort().join(',')!=='confirmation,operator,sku')throw Error('INVALID_REQUEST');
 if(typeof body.sku!=='string'||!SKU.test(body.sku)||['WM-ST-105-B-01','WM-ST-105-B-02'].includes(body.sku))throw Error('PROTECTED_SEAT');
 if(body.confirmation!==`RELEASE TEST ${body.sku}`||typeof body.operator!=='string'||body.operator.trim().length<2||body.operator.length>120)throw Error('CONFIRMATION_REQUIRED');
 return {sku:body.sku,operator:body.operator.trim()};
}
export async function handleTestRelease(request,env){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(env?.WM_ENVIRONMENT!=='TEST'||env?.SEAT_TEST_RELEASE_ENABLED!=='true'||env?.SHOPIFY_STORE_DOMAIN!=='wheeling-miners-ticket-testing.myshopify.com')return reply({error:'TEST_RELEASE_DISABLED'},423);
 if(!env?.SEAT_DB?.batch)return reply({error:'DATABASE_UNAVAILABLE'},503);
 let body;try{const raw=await request.text();if(raw.length>1024)return reply({error:'BODY_TOO_LARGE'},413);body=JSON.parse(raw)}catch{return reply({error:'INVALID_JSON'},400)}
 let input;try{input=validateTestRelease(body,env)}catch(e){return reply({error:e.message},422)}
 const {sku,operator}=input;
 const seat=await env.SEAT_DB.prepare('SELECT sku,status,price_cents,shopify_variant_id,hold_id,shopify_order_id FROM seats WHERE sku=?').bind(sku).first();
 if(!seat||seat.status!=='UNRELEASED'||seat.hold_id!==null||seat.shopify_order_id!==null||!Number.isSafeInteger(seat.price_cents)||seat.price_cents<=100||!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(seat.shopify_variant_id||''))return reply({error:'SEAT_NOT_ELIGIBLE'},409);
 try{
  await env.SEAT_DB.batch([
   env.SEAT_DB.prepare('DELETE FROM seat_admin_guard WHERE id=1'),
   env.SEAT_DB.prepare("UPDATE seats SET status='AVAILABLE',updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='UNRELEASED' AND hold_id IS NULL AND shopify_order_id IS NULL AND price_cents>100 AND shopify_variant_id=?").bind(sku,seat.shopify_variant_id),
   env.SEAT_DB.prepare('INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)'),
   env.SEAT_DB.prepare('DELETE FROM seat_admin_guard WHERE id=1'),
   env.SEAT_DB.prepare("INSERT INTO seat_admin_audit (seat_sku,action,previous_status,new_status,operator,reason) VALUES (?,'TEST_RELEASE','UNRELEASED','AVAILABLE',?,'Explicit isolated test checkout release')").bind(sku,operator)
  ]);
  return reply({ok:true,sku,status:'AVAILABLE',environment:'TEST',publicCheckoutEnabled:false});
 }catch{return reply({error:'TEST_RELEASE_CONFLICT'},409)}
}
