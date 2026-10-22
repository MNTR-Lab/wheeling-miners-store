import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../seat-admin.html',import.meta.url),'utf8');
test('admin page is noindex and staging-only',()=>{assert.match(page,/noindex,nofollow/);assert.match(page,/Ticket sales and checkout are disabled/)});
test('page connects to existing authenticated summary and availability routes',()=>{assert.match(page,/\/api\/seats\/admin\/summary/);assert.match(page,/\/api\/seats\/admin\/availability/);assert.match(page,/\/api\/seats\/section\//)});
test('admin token is not persisted in browser storage',()=>{assert.doesNotMatch(page,/localStorage|sessionStorage|document\.cookie/);assert.match(page,/type="password"/)});
test('mutations require confirmation and an operator reason',()=>{assert.match(page,/confirm\(`/);assert.match(page,/operator\.length<2\|\|reason\.length<5/)});
test('UI refuses changes to held and sold seats',()=>{assert.match(page,/\['BLOCKED','UNRELEASED','AVAILABLE'\]/);assert.match(page,/seat\.status==='BLOCKED'/)});
