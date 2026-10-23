/** V114: staging-only seat hold planner. D1 timestamps are epoch milliseconds. */
import {expiryMilliseconds} from './seat-expiry.js';
const SKU=/^WM-ST-(\d{3})-([A-Z][A-Z0-9]{0,3})-(\d{2,3})$/;
const RID=/^[A-Za-z0-9_-]{16,128}$/;
export function validateSeatRequest(input,{maxSeats=8}={}){
 if(!Array.isArray(input)||input.length<1||input.length>maxSeats)throw Error('INVALID_SELECTION_SIZE');
 if(input.some(x=>typeof x!=='string'||!SKU.test(x)))throw Error('INVALID_SKU');
 if(new Set(input).size!==input.length)throw Error('DUPLICATE_SKU');
 return [...input];
}
export function validateReservationId(id){if(typeof id!=='string'||!RID.test(id))throw Error('INVALID_RESERVATION_ID');return id;}
export function evaluateHold(skus,rows,{nowEpochMs=Date.now()}={}){
 const selected=validateSeatRequest(skus);
 if(!Array.isArray(rows)||!Number.isSafeInteger(nowEpochMs))throw Error('INVALID_INPUT');
 const map=new Map();for(const row of rows){if(!row||map.has(row.sku))throw Error('DUPLICATE_DB_ROW');map.set(row.sku,row);}
 const issues=[];let totalCents=0;
 for(const sku of selected){const row=map.get(sku);
  if(!row){issues.push({sku,reason:'NOT_FOUND'});continue;}
  if(row.status!=='AVAILABLE'){issues.push({sku,reason:'NOT_AVAILABLE'});continue;}
  if(row.hold_id||row.shopify_order_id){issues.push({sku,reason:'EXISTING_CLAIM'});continue;}
  if(!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(row.shopify_variant_id??'')){issues.push({sku,reason:'UNMAPPED'});continue;}
  if(!Number.isSafeInteger(row.price_cents)||row.price_cents<=0){issues.push({sku,reason:'INVALID_PRICE'});continue;}
  totalCents+=row.price_cents;
 }
 return {ready:issues.length===0,issues,seatCount:selected.length,totalCents:issues.length?null:totalCents};
}
function validExpiry(value){try{return expiryMilliseconds(value)}catch{throw Error('INVALID_EXPIRATION')}}
export function planHold(skus,{reservationId,expiresAt}={}){
 validateReservationId(reservationId);const selected=validateSeatRequest(skus);
 const ms=validExpiry(expiresAt);
 return selected.map(sku=>({sql:"UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='AVAILABLE' AND hold_id IS NULL AND shopify_order_id IS NULL AND shopify_variant_id IS NOT NULL",params:[reservationId,ms,sku],expectedChanges:1}));
}
export function planRelease(skus,{reservationId}={}){
 validateReservationId(reservationId);const selected=validateSeatRequest(skus);
 return selected.map(sku=>({sql:"UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND shopify_order_id IS NULL",params:[sku,reservationId],expectedChanges:1}));
}
export function planExpiryCleanup({beforeIso,beforeEpochMs,limit=100}={}){
 const ms=validExpiry(beforeEpochMs??beforeIso);
 if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('INVALID_LIMIT');
 return {selectSql:"SELECT sku,hold_id FROM seats WHERE status='HELD' AND hold_expires_at IS NOT NULL AND hold_expires_at<? AND shopify_order_id IS NULL ORDER BY hold_expires_at LIMIT ?",selectParams:[ms,limit],releaseSql:"UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='HELD' AND hold_id=? AND hold_expires_at<? AND shopify_order_id IS NULL"};
}
