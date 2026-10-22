/** V86: signed Shopify paid-order intake with read-only reservation ownership review.
 * NEVER fulfills, acknowledges assigned-seat orders, or enables ticket sales.
 */
import {inspectPaidOrderOwnership} from './seat-webhook-reconciliation.js';
import {validShopifySignature} from './seat-shopify-webhook-signature.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const MAX_BYTES=1024*1024;
export async function handleShopifyPaidWebhook(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(!env.SHOPIFY_WEBHOOK_SECRET||!env.SEAT_DB)return json({error:'WEBHOOK_NOT_CONFIGURED'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))return json({error:'PAYLOAD_TOO_LARGE'},413);
 const raw=await request.arrayBuffer();
 if(raw.byteLength>MAX_BYTES)return json({error:'PAYLOAD_TOO_LARGE'},413);
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return json({error:'INVALID_SIGNATURE'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return json({error:'UNSUPPORTED_TOPIC'},422);
 let order;
 try{order=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'INVALID_JSON'},400);}
 let inspection;
 try{inspection=await inspectPaidOrderOwnership(order,env.SEAT_DB);}catch(e){
  if(['INVALID_ORDER','TOO_MANY_SEATS','DUPLICATE_SEAT_SKU','INVALID_LINE_ITEM'].includes(e.message))return json({error:e.message,requires_reconciliation:true},422);
  throw e;
 }
 if(inspection.ignored)return json({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 // Always fail closed for assigned-seat orders. Never return a success acknowledgement.
 return json({error:'MANUAL_RECONCILIATION_REQUIRED',staging:true,requires_reconciliation:true,inspection},503);
}
