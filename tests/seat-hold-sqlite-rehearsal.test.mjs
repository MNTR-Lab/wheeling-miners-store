import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../tools/seat-hold-sqlite-rehearsal.py',import.meta.url));
test('offline atomic hold rehearsal protects overlapping selections',()=>{
 const p=spawnSync('python3',[file],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 const result=JSON.parse(p.stdout);
 assert.equal(result.mode,'OFFLINE_SQLITE_ONLY');
 assert.equal(result.atomic_rollback,true);
 assert.equal(result.expired_hold_recovery,true);
 assert.equal(result.stale_expiry_protection,true);
 assert.equal(result.sales_enabled,false);
});
test('rehearsal never connects to remote databases',()=>{
 const p=spawnSync('python3',['-c',`import pathlib,sys; s=pathlib.Path(sys.argv[1]).read_text(); assert 'cloudflare' not in s.lower(); assert 'requests' not in s; assert "sqlite3.connect(':memory:'" in s`,file],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
});
