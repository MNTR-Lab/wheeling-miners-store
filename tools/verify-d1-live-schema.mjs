/** V110: inspect Cloudflare D1 JSON query output offline. No DB connection or writes. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inspectSeatSchema,sqlInspectionCommands} from './verify-seat-transaction-schema.mjs';
const tables=['seats','reservations','reservation_seats','seat_admin_guard'];
export function parseD1SchemaResults(raw){
 if(!Array.isArray(raw))throw Error('EXPECTED_D1_RESULT_ARRAY');
 const output={};
 const extract=x=>Array.isArray(x?.results)?x.results:Array.isArray(x?.result?.results)?x.result.results:null;
 if(raw.length!==5)throw Error('EXPECTED_FIVE_QUERIES');
 const master=extract(raw[0]);if(!master)throw Error('INVALID_MASTER_RESULT');
 const guard=master.find(x=>x.name==='seat_admin_guard');output.seat_admin_guard_sql=guard?.sql??null;
 for(let i=0;i<tables.length;i++){
  const rows=extract(raw[i+1]);if(!rows)throw Error('INVALID_PRAGMA_RESULT_'+tables[i]);
  output[tables[i]]=rows.map(x=>({name:x.name,type:x.type}));
 }
 return output;
}
export function inspectD1QueryResults(raw){const schema=parseD1SchemaResults(raw);return {schema,report:inspectSeatSchema(schema)};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv[2]==='--commands')console.log(sqlInspectionCommands().join('\n'));
  else if(process.argv.length===3){const report=inspectD1QueryResults(JSON.parse(readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(report,null,2));if(!report.report.ready)process.exitCode=2;}
  else throw Error('Usage: node tools/verify-d1-live-schema.mjs --commands | d1-results.json');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
