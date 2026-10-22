/** V108: offline schema contract preflight. No DB connection, SQL execution, or writes. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const REQUIREMENTS={
 seats:['sku','status','hold_id','hold_expires_at','shopify_order_id','shopify_variant_id','price_cents'],
 reservations:['id','status','checkout_nonce','expires_at','shopify_order_id'],
 reservation_seats:['reservation_id','seat_sku','shopify_variant_id'],
 seat_admin_guard:['id','valid']
};
export function inspectSeatSchema(schema){
 if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error('INVALID_SCHEMA');
 const issues=[];
 for(const [table,columns] of Object.entries(REQUIREMENTS)){
  const actual=schema[table];
  if(!Array.isArray(actual)){issues.push({table,reason:'MISSING_TABLE'});continue;}
  const names=new Set(actual.map(c=>typeof c==='string'?c:c?.name).filter(x=>typeof x==='string'));
  for(const column of columns)if(!names.has(column))issues.push({table,column,reason:'MISSING_COLUMN'});
 }
 const guard=schema.seat_admin_guard_sql;
 if(typeof guard!=='string'||!/CHECK\s*\(\s*valid\s*=\s*1\s*\)/i.test(guard))issues.push({table:'seat_admin_guard',reason:'ROLLBACK_GUARD_NOT_VERIFIED'});
 const reservation=schema.reservations??[];
 const expiry=reservation.find(c=>c?.name==='expires_at');
 if(expiry&&typeof expiry==='object'&&/INT/i.test(expiry.type??''))issues.push({table:'reservations',column:'expires_at',reason:'LEGACY_INTEGER_EXPIRY_INCOMPATIBLE'});
 const hold=schema.seats??[];
 const holdExpiry=hold.find(c=>c?.name==='hold_expires_at');
 if(holdExpiry&&typeof holdExpiry==='object'&&/INT/i.test(holdExpiry.type??''))issues.push({table:'seats',column:'hold_expires_at',reason:'LEGACY_INTEGER_EXPIRY_INCOMPATIBLE'});
 return {mode:'OFFLINE_PREFLIGHT',ready:issues.length===0,issues,checked_tables:Object.keys(REQUIREMENTS),sales_enabled:false};
}
export function sqlInspectionCommands(){return ["SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('seats','reservations','reservation_seats','seat_admin_guard') ORDER BY name;",...Object.keys(REQUIREMENTS).map(t=>`PRAGMA table_info(${t});`)];}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv[2]==='--commands'){console.log(sqlInspectionCommands().join('\n'));}
  else if(process.argv.length===3){const report=inspectSeatSchema(JSON.parse(readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=2;}
  else throw Error('Usage: node tools/verify-seat-transaction-schema.mjs --commands | schema-report.json');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
