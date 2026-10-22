/** V101: authenticated, read-only checkout readiness preview. Never grants sales authority. */
import {inspectCheckoutGate} from './seat-checkout-gate.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const MAX_BYTES=4096;
export async function handleCheckoutPreview(request,env){
 if(request.method!=='POST')return respond({error:'METHOD_NOT_ALLOWED'},405);
 if(!env?.SEAT_DB?.prepare)return respond({error:'DATABASE_UNAVAILABLE'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX_BYTES))return respond({error:'PAYLOAD_TOO_LARGE'},413);
 let bytes;try{bytes=await request.arrayBuffer();}catch{return respond({error:'INVALID_BODY'},400)}
 if(bytes.byteLength>MAX_BYTES)return respond({error:'PAYLOAD_TOO_LARGE'},413);
 let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return respond({error:'INVALID_JSON'},400)}
 try{
  // Never accept client-supplied readiness flags. All integration approvals remain false.
  const preview=await inspectCheckoutGate(env.SEAT_DB,payload?.skus,{
   approvedManifest:false,checkoutConfigured:false,webhookConfigured:false
  });
  return respond({mode:'ADMIN_STAGING',preview_only:true,sales_enabled:false,checkout_enabled:false,holds_enabled:false,preview});
 }catch(error){
  if(error?.message==='INVALID_SELECTION')return respond({error:'INVALID_SELECTION'},422);
  return respond({error:'PREVIEW_UNAVAILABLE'},503);
 }
}
