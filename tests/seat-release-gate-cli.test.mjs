import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {evaluateSeatReleaseGate} from '../tools/seat-release-gate.mjs';
const good={
 manifest:{version:'V53',mode:'OFFLINE_READ_ONLY',issue_count:0,manifest_matches_staging:true,ready_for_sales:false,shopify_mutations:0,d1_mutations:0},
 shopify:{version:'V52',mode:'READ_ONLY',issue_count:0,ready_for_sales:false,sales_enabled:false,shopify_mutations:0,d1_mutations:0},
 mapping:{mode:'READ_ONLY',issue_count:0,approved_for_release:false},
 operations:{venue_manifest_signed_off:true,checkout_end_to_end_passed:true,payment_webhook_reconciled:true,oversell_prevention_verified:true,refund_cancellation_tested:true}
};
test('clean checklist still does not authorize sales',()=>{const r=evaluateSeatReleaseGate(good);assert.equal(r.checklist_complete,true);assert.equal(r.ready_for_sales,false);assert.equal(r.authorization_granted,false);});
test('malformed audit data fails closed',()=>{for(const key of ['manifest','shopify','mapping']){for(const replacement of [null,{}, {...good[key],issue_count:'0'}]){const r=evaluateSeatReleaseGate({...good,[key]:replacement});assert.ok(r.blockers.length,`${key} invalid`);}}});
test('all operational flags are mandatory',()=>{for(const key of Object.keys(good.operations)){const r=evaluateSeatReleaseGate({...good,operations:{...good.operations,[key]:'true'}});assert.equal(r.checklist_complete,false);}});
test('CLI accepts exactly four inputs and optional output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'miners-gate-'));try{
  const paths=['manifest','shopify','mapping','operations'].map(k=>{const p=join(dir,k+'.json');writeFileSync(p,JSON.stringify(good[k]));return p;});
  const script=resolve('tools/seat-release-gate.mjs');
  const stdout=spawnSync(process.execPath,[script,...paths],{encoding:'utf8'});assert.equal(stdout.status,0,stdout.stderr);assert.equal(JSON.parse(stdout.stdout).checklist_complete,true);
  const output=join(dir,'report.json');const saved=spawnSync(process.execPath,[script,...paths,output],{encoding:'utf8'});assert.equal(saved.status,0,saved.stderr);assert.equal(JSON.parse(readFileSync(output,'utf8')).sales_enabled,false);
  const overwrite=spawnSync(process.execPath,[script,...paths,output],{encoding:'utf8'});assert.equal(overwrite.status,2);assert.match(overwrite.stderr,/EEXIST/);
  const missing=spawnSync(process.execPath,[script,...paths.slice(0,3)],{encoding:'utf8'});assert.equal(missing.status,2);assert.match(missing.stderr,/Usage/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
