/** V101: authenticated staging administration, payment and checkout previews. */
import {seatCatalogAudit} from './seat-catalog-audit.js';
import {mappingReport} from './seat-mapping-report.js';
import {seasonTicketPlan} from './season-ticket-plan.js';
import {seatVariantManifest} from './seat-variant-manifest.js';
import {handlePaymentAudit} from './seat-payment-audit.js';
import {handleOwnershipPreview} from './seat-ownership-preview.js';
import {handleCheckoutPreview} from './seat-checkout-preview.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
function authorized(request,env){
 const expected=env.SEAT_ADMIN_TOKEN;
 const supplied=request.headers.get('authorization');
 if(typeof expected!=='string'||expected.length<32||!supplied?.startsWith('Bearer '))return false;
 const token=supplied.slice(7);
 if(token.length!==expected.length)return false;
 let difference=0;for(let i=0;i<token.length;i++)difference|=token.charCodeAt(i)^expected.charCodeAt(i);
 return difference===0;
}
export async function handleSeatAdmin(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/seats/admin/'))return null;
 if(!env.SEAT_DB)return reply({error:'Seat database unavailable'},503);
 if(!authorized(request,env))return reply({error:'Unauthorized'},401);
 if(path==='/api/seats/admin/checkout-preview')return handleCheckoutPreview(request,env);
 if(path==='/api/seats/admin/ownership-preview')return handleOwnershipPreview(request,env);
 if(path==='/api/seats/admin/payment-audit')return handlePaymentAudit(request,env);
 if(path==='/api/seats/admin/mapping-report')return mappingReport(request,env);
 if(path==='/api/seats/admin/season-plan')return seasonTicketPlan(request,env);
 if(path==='/api/seats/admin/variant-manifest')return seatVariantManifest(request,env);
 if(path==='/api/seats/admin/catalog-audit')return seatCatalogAudit(request,env);
 if(path==='/api/seats/admin/summary'&&request.method==='GET'){
  const result=await env.SEAT_DB.prepare('SELECT section,status,COUNT(*) AS count FROM seats GROUP BY section,status ORDER BY section,status').all();
  return reply({mode:'ADMIN_STAGING',sales_enabled:false,sections:result.results});
 }
 if(path!=='/api/seats/admin/availability'||request.method!=='POST')return reply({error:'Not found'},404);
 let payload;try{payload=await request.json();}catch{return reply({error:'Invalid JSON'},400);}
 const {sku,action,reason,operator}=payload||{};
 if(typeof sku!=='string'||!SKU.test(sku)||!['BLOCK','UNBLOCK'].includes(action)||typeof reason!=='string'||reason.trim().length<5||reason.length>500||typeof operator!=='string'||operator.trim().length<2||operator.length>120)return reply({error:'Invalid change request'},400);
 const target=action==='BLOCK'?'BLOCKED':'UNRELEASED';
 const allowed=action==='BLOCK'?"status IN ('UNRELEASED','AVAILABLE')":"status='BLOCKED'";
 const statements=[
  env.SEAT_DB.prepare('DELETE FROM seat_admin_guard WHERE id=1'),
  env.SEAT_DB.prepare(`INSERT INTO seat_admin_audit (seat_sku,action,previous_status,new_status,operator,reason) SELECT sku,?,status,?,?,? FROM seats WHERE sku=? AND ${allowed} AND hold_id IS NULL AND shopify_order_id IS NULL`).bind(action,target,operator.trim(),reason.trim(),sku),
  env.SEAT_DB.prepare(`UPDATE seats SET status=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND ${allowed} AND hold_id IS NULL AND shopify_order_id IS NULL`).bind(target,sku),
  env.SEAT_DB.prepare('INSERT INTO seat_admin_guard (id,valid) VALUES (1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)')
 ];
 try{await env.SEAT_DB.batch(statements);return reply({ok:true,sku,action,status:target,mode:'ADMIN_STAGING',sales_enabled:false});}
 catch(e){return reply({error:'Seat unavailable or change could not be committed',code:'CHANGE_REJECTED'},409);}
}
