/** V66: read-only preflight for seat administration D1 migration.
 * Does not connect to Cloudflare, modify schema, or enable sales.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const REQUIRED=['seat_admin_audit','seat_admin_guard'];
export function verifyAdminMigration({schema,existingTables,seatCount,sectionCount}={}){
 const issues=[];
 if(typeof schema!=='string'||!REQUIRED.every(t=>new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${t}\\b`,'i').test(schema)))issues.push('Missing expected CREATE TABLE statements');
 if(/\b(DROP|DELETE|UPDATE|ALTER|INSERT|REPLACE)\b/i.test(schema.replace(/--[^\n]*/g,'')))issues.push('Migration contains data mutation or destructive SQL');
 if(!Array.isArray(existingTables)||existingTables.some(x=>typeof x!=='string'))issues.push('Existing table names are required');
 if(!Number.isInteger(seatCount)||seatCount<1)issues.push('Seat count must be positive');
 if(!Number.isInteger(sectionCount)||sectionCount<1)issues.push('Section count must be positive');
 const collisions=Array.isArray(existingTables)?REQUIRED.filter(x=>existingTables.includes(x)):[];
 if(collisions.length)issues.push('Admin tables already exist: '+collisions.join(', '));
 return {mode:'READ_ONLY_PREFLIGHT',safe_to_review:issues.length===0,approved_to_apply:false,sales_enabled:false,seatCount,sectionCount,issues,warning:'Requires D1 backup, manual migration approval, and administrator secret configuration.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==4)throw Error('Usage: node tools/verify-seat-admin-migration.mjs schema.sql d1-inspection.json');
 const schema=readFileSync(process.argv[2],'utf8');const snapshot=JSON.parse(readFileSync(process.argv[3],'utf8'));
 const result=verifyAdminMigration({schema,...snapshot});console.log(JSON.stringify(result,null,2));if(!result.safe_to_review)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
