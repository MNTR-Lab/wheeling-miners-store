/** Read-only deployed TEST selector integration smoke check. No writes or credentials. */
import assert from 'node:assert/strict';
const base = 'https://wheeling-miners-store-test.bikard.workers.dev';
const timeout = 20000;
async function request(path, init = {}) {
  const response = await fetch(base + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout), ...init });
  const body = await response.text();
  return { response, body };
}
const page = await request('/seat-selector.html');
assert.equal(page.response.status, 200, 'TEST seat selector must load');
assert.match(page.body, /<html\b/i);
assert.match(page.body, /<script\s+src="\/assets\/seat-live\.js"\s+defer><\/script>/i, 'Worker must inject live seat overlay');
const asset = await request('/assets/seat-live.js');
assert.equal(asset.response.status, 200, 'Live overlay asset must load');
assert.match(asset.body, /\/api\/seats\/section\//, 'Overlay must read live section data');
assert.match(asset.body, /grid\.replaceChildren/, 'Overlay must replace preview seats');
assert.match(asset.body, /button\.disabled\s*=\s*true/, 'Overlay must disable purchases');
assert.doesNotMatch(asset.body, /fetch\s*\(\s*['"`]\/api\/seats\/(?:hold|checkout)/, 'Overlay must not call sales APIs');
const status = await request('/api/seats/status');
assert.equal(status.response.status, 200);
const state = JSON.parse(status.body);
assert.equal(state.mode, 'STAGING');
assert.equal(state.checkout_enabled, false);
assert.equal(state.holds_enabled, false);
const section = await request('/api/seats/section/105');
assert.equal(section.response.status, 200);
const seats = JSON.parse(section.body);
assert.equal(seats.section, '105');
assert.equal(seats.checkout_enabled, false);
for (const sku of ['WM-ST-105-B-01', 'WM-ST-105-B-02']) {
  assert.ok(seats.seats.some(s => s.sku === sku && s.status === 'SOLD'), `Protected SOLD fixture missing: ${sku}`);
}
for (const endpoint of ['/api/seats/hold', '/api/seats/checkout']) {
  const result = await request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(result.response.status, 423, `${endpoint} must stay locked`);
}
console.log('PASS: Deployed TEST selector injects current live overlay; inventory remains authoritative and checkout is locked.');
