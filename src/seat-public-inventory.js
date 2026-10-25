/** Public, read-only inventory for the customer season-ticket page.
 * Does not mutate D1, publish Shopify products, or enable sales.
 */
import {publicSalesEnabled} from './seat-public-checkout.js';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
export async function handlePublicInventory(request,env){
 const path=new URL(request.url).pathname;
 if(path!=='/api/seats/public-status'&&!/^\/api\/seats\/public-section\/\d{3}$/.test(path))return null;
 if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
 const enabled=publicSalesEnabled(env);
 if(path==='/api/seats/public-status'){
  if(!enabled)return reply({salesEnabled:false,mode:'NOT_OPEN',maxSeats:8,holdMinutes:15,sections:[]});
  if(!env?.SEAT_DB?.prepare)return reply({error:'DATABASE_UNAVAILABLE'},503);
  try{
   const result=await env.SEAT_DB.prepare('SELECT DISTINCT section FROM seats ORDER BY section').all();
   return reply({salesEnabled:true,mode:'OPEN',maxSeats:8,holdMinutes:15,sections:(result?.results||[]).map(x=>String(x.section))});
  }catch(e){console.error('Public section listing failed',e?.message);return reply({error:'INVENTORY_UNAVAILABLE'},503)}
 }
 if(!enabled)return reply({error:'PUBLIC_SALES_NOT_ENABLED',salesEnabled:false},423);
 if(!env?.SEAT_DB?.prepare)return reply({error:'DATABASE_UNAVAILABLE'},503);
 const section=path.split('/').pop();
 try{
  const result=await env.SEAT_DB.prepare('SELECT sku,row_label,seat_number,price_cents,status,shopify_variant_id FROM seats WHERE section=? ORDER BY row_label,seat_number DESC').bind(section).all();
  const rows=result?.results||[];
  if(!rows.length)return reply({error:'SECTION_NOT_FOUND'},404);
  const seats=rows.map(s=>({sku:s.sku,row:s.row_label,number:s.seat_number,priceCents:s.price_cents,available:s.status==='AVAILABLE'&&/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(s.shopify_variant_id||'')}));
  return reply({section,salesEnabled:true,seats});
 }catch(e){console.error('Public inventory read failed',e?.message);return reply({error:'INVENTORY_UNAVAILABLE'},503)}
}
