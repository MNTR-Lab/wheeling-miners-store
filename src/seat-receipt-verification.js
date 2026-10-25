/** Staff-only receipt lookup and atomic physical ticket issuance.
 * Mounted only behind the existing SEAT_ADMIN_TOKEN authentication.
 * Does not generate or expose a public receipt URL.
 */
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const ORDER=/^[1-9][0-9]{0,19}$/;
const NAME=/^[\p{L}\p{N} .,'-]{2,120}$/u;
function orderId(value){return typeof value==='string'&&ORDER.test(value)?value:null}
export async function handleReceiptVerification(request,env){
 if(!env?.SEAT_DB?.prepare||!env?.SEAT_DB?.batch)return respond({error:'DATABASE_UNAVAILABLE'},503);
 const url=new URL(request.url);
 const path=url.pathname;
 if(path==='/api/seats/admin/receipt-lookup'){
  if(request.method!=='GET')return respond({error:'METHOD_NOT_ALLOWED'},405);
  const id=orderId(url.searchParams.get('order_id'));
  if(!id)return respond({error:'INVALID_ORDER_ID'},422);
  const rows=await env.SEAT_DB.prepare("SELECT sku,section,row_label,seat_number,price_cents,status,shopify_order_id FROM seats WHERE shopify_order_id=? ORDER BY section,row_label,seat_number").bind(id).all();
  const seats=rows?.results??[];
  if(!seats.length)return respond({error:'PAID_ORDER_NOT_FOUND'},404);
  if(seats.some(s=>s.status!=='SOLD'))return respond({error:'ORDER_REQUIRES_RECONCILIATION'},409);
  let issue;
  try{issue=await env.SEAT_DB.prepare('SELECT shopify_order_id,issued_at,issued_by FROM seat_ticket_issuance WHERE shopify_order_id=?').bind(id).first()}
  catch{return respond({error:'ISSUANCE_SCHEMA_NOT_INSTALLED'},503)}
  return respond({ok:true,order_id:id,paid_order_verified_by:'SHOPIFY_PAID_WEBHOOK',ticket_type:'FULL_SEASON',seats:seats.map(({sku,section,row_label,seat_number})=>({sku,section,row:row_label,seat:seat_number})),seat_count:seats.length,issuance:issue?{status:'ISSUED',issued_at:issue.issued_at,issued_by:issue.issued_by}:{status:'NOT_ISSUED'},staff_only:true});
 }
 if(path==='/api/seats/admin/receipt-issue'){
  if(request.method!=='POST')return respond({error:'METHOD_NOT_ALLOWED'},405);
  let body;
  try{const raw=await request.text();if(raw.length>2048)return respond({error:'BODY_TOO_LARGE'},413);body=JSON.parse(raw)}catch{return respond({error:'INVALID_JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='confirmation,operator,order_id')return respond({error:'INVALID_REQUEST'},422);
  const id=orderId(body.order_id);
  if(!id||typeof body.operator!=='string'||!NAME.test(body.operator.trim())||body.confirmation!==`ISSUE TICKETS ${id}`)return respond({error:'CONFIRMATION_REQUIRED'},422);
  const count=await env.SEAT_DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold FROM seats WHERE shopify_order_id=?").bind(id).first();
  if(!count?.n||count.n!==count.sold)return respond({error:'ORDER_NOT_VERIFIED'},409);
  try{
   const results=await env.SEAT_DB.batch([
    env.SEAT_DB.prepare('INSERT INTO seat_ticket_issuance (shopify_order_id,issued_by,seat_count) VALUES (?,?,?)').bind(id,body.operator.trim(),count.n),
    env.SEAT_DB.prepare('INSERT INTO seat_ticket_issuance_audit (shopify_order_id,action,operator,seat_count) VALUES (?,?,?,?)').bind(id,'ISSUED',body.operator.trim(),count.n)
   ]);
   return respond({ok:true,order_id:id,status:'ISSUED',seat_count:count.n,operator:body.operator.trim()},201);
  }catch{return respond({error:'ALREADY_ISSUED_OR_DATABASE_UNAVAILABLE'},409)}
 }
 return null;
}
