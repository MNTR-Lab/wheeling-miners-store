/** V93: signed Shopify orders/paid intake; staging read-only and fail closed.
 * Assigned-seat orders are NEVER acknowledged or fulfilled by this endpoint.
 */
import {inspectPaidOrderOwnership} from './seat-webhook-reconciliation.js';
import {validShopifySignature} from './seat-shopify-webhook-signature.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const MAX_BYTES=1024*1024;
const ORDER_ERRORS=new Set(['INVALID_ORDER','INVALID_SEAT_LIMIT','TOO_MANY_SEATS','DUPLICATE_SEAT_SKU','INVALID_LINE_ITEM','DUPLICATE_PAID_VARIANT']);
export async function handleShopifyPaidWebhook(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(typeof env?.SHOPIFY_WEBHOOK_SECRET!=='string'||!env.SHOPIFY_WEBHOOK_SECRET||!env.SEAT_DB?.prepare)return json({error:'WEBHOOK_NOT_CONFIGURED'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX_BYTES))return json({error:'PAYLOAD_TOO_LARGE'},413);
 let raw;
 try{raw=await request.arrayBuffer();}catch{return json({error:'PAYLOAD_READ_FAILED'},400);}
 if(raw.byteLength>MAX_BYTES)return json({error:'PAYLOAD_TOO_LARGE'},413);
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return json({error:'INVALID_SIGNATURE'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return json({error:'UNSUPPORTED_TOPIC'},422);
 let order;
 try{order=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return json({error:'INVALID_JSON'},400);}
 let inspection;
 try{inspection=await inspectPaidOrderOwnership(order,env.SEAT_DB);}catch(e){
  if(ORDER_ERRORS.has(e?.message))return json({error:e.message,requires_reconciliation:true},422);
  // Avoid exposing database/internal errors to unauthenticated clients.
  return json({error:'RECONCILIATION_UNAVAILABLE',requires_reconciliation:true},503);
 }
 if(inspection.ignored)return json({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 // Staging invariant: do not return 2xx for assigned seats, including replays.
 return json({error:'MANUAL_RECONCILIATION_REQUIRED',staging:true,requires_reconciliation:true,inspection},503);
}
