/** Read-only source contract audit. Does not connect to Cloudflare or Shopify. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const read=(root,path)=>readFileSync(resolve(root,path),'utf8');
export function auditTransactionContract(root){
 const reservation=read(root,'src/seat-reservation-transaction.js');
 const paid=read(root,'src/seat-paid-commit.js');
 const ownership=read(root,'src/seat-checkout-linkage.js');
 const fulfillment=read(root,'src/seat-fulfillment-transaction.js');
 const hold=read(root,'src/seat-reservation-core.js');
 const issues=[];
 if(/INSERT INTO reservations\s*\(id,status,checkout_nonce,expires_at\)/.test(reservation))issues.push('RESERVATION_CREATED_AT_REQUIRED_BUT_NOT_INSERTED');
 if(/status='PAID'/.test(paid)||/status==='PAID'/.test(fulfillment)||/status!=='PAID'/.test(fulfillment)||/['\"]PAID['\"]/.test(ownership))issues.push('PAID_STATUS_NOT_IN_PRODUCTION_RESERVATION_ENUM');
 if(/Date\.parse\(reservation\.expires_at\)/.test(ownership)||/typeof reservation\.expires_at!=='string'/.test(ownership))issues.push('OWNERSHIP_EXPECTS_ISO_EXPIRY_BUT_PRODUCTION_USES_INTEGER');
 if(/typeof r\.hold_expires_at!=='string'/.test(fulfillment))issues.push('FULFILLMENT_EXPECTS_ISO_HOLD_EXPIRY_BUT_PRODUCTION_USES_INTEGER');
 if(/hold_expires_at=\?/.test(hold)&&/expiresAt.*string/.test(hold))issues.push('HOLD_PLANNER_WRITES_ISO_EXPIRY_TO_INTEGER_COLUMN');
 return {ready:issues.length===0,issues,sales_enabled:false,production_mutations:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const root=process.argv[2]??process.cwd();const result=auditTransactionContract(root);console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=2;}
 catch(e){console.error('AUDIT_ERROR:',e.message);process.exitCode=1;}
}
