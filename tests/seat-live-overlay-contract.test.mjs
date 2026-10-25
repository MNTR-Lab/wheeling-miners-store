import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../assets/seat-live.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const config=JSON.parse(readFileSync(new URL('../wrangler.test.jsonc',import.meta.url),'utf8'));
test('selector loads live overlay on TEST Worker',()=>{
 assert.match(worker,/new AddLiveSeatScript\(\)/);
 assert.match(worker,/seat-live\.js/);
 assert.ok(config.assets.run_worker_first.includes('/seat-selector.html'));
});
test('overlay obtains authoritative section inventory and fails closed',()=>{
 assert.match(script,/\/api\/seats\/section\/\$\{section\}/);
 assert.match(script,/data\.checkout_enabled!==false/);
 assert.match(script,/button\.disabled=true/);
 assert.match(script,/seen\.has\(seat\.sku\)/);
 assert.match(script,/grid\.replaceChildren\(\)/);
 assert.doesNotMatch(script,/\/api\/seats\/(?:hold|checkout)/);
});
test('deployment includes overlay changes',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/wheeling-test-worker-deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/assets\/seat-live\.js/);
 assert.match(workflow,/seat-selector\.html/);
 assert.match(workflow,/tests\/seat-live-overlay-contract\.test\.mjs/);
 assert.match(workflow,/wrangler\.test\.jsonc/);
 assert.match(workflow,/deploy --config wrangler\.test\.jsonc/);
});
