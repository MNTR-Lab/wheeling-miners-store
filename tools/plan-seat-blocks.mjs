/** V62: offline, review-only admin seat block planner. Never executes SQL. */
import {pathToFileURL} from 'node:url';
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
export function planSeatBlocks({skus,action,reason,operator}={}) {
 if(!Array.isArray(skus)||skus.length<1||skus.length>250||skus.some(s=>typeof s!=='string'||!SKU.test(s))||new Set(skus).size!==skus.length)throw Error('Provide 1–250 unique valid seat SKUs');
 if(!['BLOCK','UNBLOCK'].includes(action))throw Error('Action must be BLOCK or UNBLOCK');
 if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw Error('A reason of 5–500 characters is required');
 if(typeof operator!=='string'||!operator.trim()||operator.length>120)throw Error('Operator identity required');
 const sql=action==='BLOCK'
  ? "UPDATE seats SET status='BLOCKED',updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status IN ('UNRELEASED','AVAILABLE') AND hold_id IS NULL AND shopify_order_id IS NULL"
  : "UPDATE seats SET status='UNRELEASED',updated_at=CURRENT_TIMESTAMP WHERE sku=? AND status='BLOCKED' AND hold_id IS NULL AND shopify_order_id IS NULL";
 return {version:'V62',mode:'REVIEW_ONLY',executable:false,checkout_enabled:false,sales_enabled:false,action,reason:reason.trim(),operator:operator.trim(),seatCount:skus.length,steps:skus.map(sku=>({sql,params:[sku],requiredChanges:1})),requires:['authenticated admin role','atomic execution with row-count guards','durable audit log','reconcile Shopify inventory before sales'],warning:'Do not execute individual steps; no seats have been changed.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [action,operator,reason,...skus]=process.argv.slice(2);console.log(JSON.stringify(planSeatBlocks({action,operator,reason,skus}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
