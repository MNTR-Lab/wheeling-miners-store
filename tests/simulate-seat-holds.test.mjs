import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const script = new URL('../tools/simulate-seat-holds.py', import.meta.url).pathname;
const run = (code) => spawnSync('python3', ['-c', `import importlib.util,sqlite3\ns=importlib.util.spec_from_file_location('hold',${JSON.stringify(script)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${code}`], {encoding:'utf8'});
test('rehearsal blocks double booking and partial holds',()=>{
 const p=spawnSync('python3',[script],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout);
 assert.equal(result.sales_enabled,false);assert.equal(result.double_booking_prevented,true);
 assert.equal(result.partial_holds_prevented,true);
});
test('hold rollback leaves other seats available',()=>{
 const p=run(`db=sqlite3.connect(':memory:',isolation_level=None);db.executescript(m.SCHEMA)\ndb.execute("INSERT INTO seats VALUES('WM-ST-101-A-01','AVAILABLE','1',NULL,NULL)")\ntry:m.create_hold(db,['WM-ST-101-A-01','WM-ST-101-A-02'],100)\nexcept m.HoldRejected:pass\nassert db.execute("SELECT status FROM seats").fetchone()[0]=='AVAILABLE'\nassert db.execute('SELECT count(*) FROM reservations').fetchone()[0]==0`);
 assert.equal(p.status,0,p.stderr);
});
test('unreleased and unmapped seats cannot be held',()=>{
 const p=run(`db=sqlite3.connect(':memory:',isolation_level=None);db.executescript(m.SCHEMA)\ndb.execute("INSERT INTO seats VALUES('WM-ST-101-A-01','UNRELEASED','1',NULL,NULL)")\ndb.execute("INSERT INTO seats VALUES('WM-ST-101-A-02','AVAILABLE',NULL,NULL,NULL)")\nfor sku in ['WM-ST-101-A-01','WM-ST-101-A-02']:\n try:m.create_hold(db,[sku],100);raise AssertionError('accepted')\n except m.HoldRejected:pass`);
 assert.equal(p.status,0,p.stderr);
});
test('stale expiry cannot free a new hold',()=>{
 const p=run(`db=sqlite3.connect(':memory:',isolation_level=None);db.executescript(m.SCHEMA)\ndb.execute("INSERT INTO seats VALUES('WM-ST-101-A-01','AVAILABLE','1',NULL,NULL)")\nm.create_hold(db,['WM-ST-101-A-01'],100,ttl=10,hold_id='old')\nm.create_hold(db,['WM-ST-101-A-01'],111,ttl=10,hold_id='new')\nassert m.expire_hold(db,'old',112) is True\nassert db.execute('SELECT hold_id FROM seats').fetchone()[0]=='new'`);
 assert.equal(p.status,0,p.stderr);
});
