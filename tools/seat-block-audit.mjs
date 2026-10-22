/** V63: offline validation of proposed administrator seat changes against a D1 export.
 * No network, database mutation, or checkout activation.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {planSeatBlocks} from './plan-seat-blocks.mjs';
const validStates=new Set(['UNRELEASED','AVAILABLE','HELD','SOLD','BLOCKED']);
export function auditSeatBlockChange({seats,skus,action,operator,reason}={}){
 const plan=planSeatBlocks({skus,action,operator,reason});
 if(!Array.isArray(seats))throw Error('Seat export must be an array');
 const bySku=new Map();
 for(const seat of seats){
  if(!seat||typeof seat.sku!=='string'||!validStates.has(seat.status))throw Error('Malformed seat export');
  if(bySku.has(seat.sku))throw Error('Duplicate SKU in seat export: '+seat.sku);
  bySku.set(seat.sku,seat);
 }
 const findings=skus.map(sku=>{
  const seat=bySku.get(sku);
  if(!seat)return {sku,eligible:false,reason:'UNKNOWN_SEAT'};
  if(seat.shopify_order_id!=null&&String(seat.shopify_order_id).trim()!=='')return {sku,eligible:false,reason:'HAS_ORDER'};
  if(seat.hold_id!=null&&String(seat.hold_id).trim()!=='')return {sku,eligible:false,reason:'HAS_HOLD'};
  if(action==='BLOCK'&&!['UNRELEASED','AVAILABLE'].includes(seat.status))return {sku,eligible:false,reason:'STATUS_'+seat.status};
  if(action==='UNBLOCK'&&seat.status!=='BLOCKED')return {sku,eligible:false,reason:'STATUS_'+seat.status};
  return {sku,eligible:true,from:seat.status,to:action==='BLOCK'?'BLOCKED':'UNRELEASED'};
 });
 const eligible=findings.every(x=>x.eligible);
 return {version:'V63',mode:'OFFLINE_AUDIT',executable:false,sales_enabled:false,approved_for_execution:false,operator:plan.operator,reason:plan.reason,action,requested:skus.length,eligible,findings,warning:'Read-only audit against a snapshot. Revalidate atomically before any future database write.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length<8)throw Error('Usage: node tools/seat-block-audit.mjs seats.json BLOCK|UNBLOCK operator reason output.json SKU [SKU...]');
  const [source,action,operator,reason,out,...skus]=process.argv.slice(2);
  const input=JSON.parse(readFileSync(source,'utf8'));
  const seats=Array.isArray(input)?input:input?.results??input?.[0]?.results;
  const report=auditSeatBlockChange({seats,action,operator,reason,skus});
  writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({eligible:report.eligible,requested:report.requested,output:out}));
  if(!report.eligible)process.exitCode=2;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
