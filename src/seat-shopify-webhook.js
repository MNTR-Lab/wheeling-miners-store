/** V82: authenticated Shopify orders/paid intake, read-only reconciliation.
 * Sales and automatic fulfillment remain disabled. No D1 writes.
 */
import {auditPaidOrder} from './seat-payment-audit.js';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const MAX_BYTES=1024*1024;
export async function validShopifySignature(raw,signature,secret){
 if(typeof secret!=='string'||!secret||typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));
 const expected=btoa(String.fromCharCode(...digest));
 if(expected.length!==signature.length)return false;
 let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^signature.charCodeAt(i);
 return difference===0;
}
export async function handleShopifyPaidWebhook(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(!env.SHOPIFY_WEBHOOK_SECRET||!env.SEAT_DB)return json({error:'WEBHOOK_NOT_CONFIGURED'},503);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))return json({error:'PAYLOAD_TOO_LARGE'},413);
 const raw=await request.arrayBuffer();if(raw.byteLength>MAX_BYTES)return json({error:'PAYLOAD_TOO_LARGE'},413);
 if(!await validShopifySignature(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_WEBHOOK_SECRET))return json({error:'INVALID_SIGNATURE'},401);
 if(request.headers.get('x-shopify-topic')!=='orders/paid')return json({error:'UNSUPPORTED_TOPIC'},422);
 let order;try{order=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'INVALID_JSON'},400);}
 let audit;try{audit=await auditPaidOrder(order,env.SEAT_DB);}catch(e){
  if(['INVALID_ORDER','TOO_MANY_SEATS','DUPLICATE_SEAT_SKU','INVALID_LINE_ITEM'].includes(e.message))return json({error:e.message,requires_reconciliation:true},422);
  throw e;
 }
 if(audit.ignored)return json({ok:true,ignored:true,reason:'NO_ASSIGNED_SEATS'});
 // Never acknowledge an assigned-seat payment as fulfilled until atomic reservation
 // ownership and SOLD transitions are implemented. Shopify retries 503 responses.
 return json({error:'MANUAL_RECONCILIATION_REQUIRED',staging:true,requires_reconciliation:true,seat_count:audit.seat_count,seat_mapping_valid:audit.seat_mapping_valid,issues:audit.issues},503);
}
