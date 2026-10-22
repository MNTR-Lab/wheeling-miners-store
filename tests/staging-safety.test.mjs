import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/seat-api.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const wrangler=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
test('seat API advertises checkout and holds disabled',()=>{
 assert.match(api,/checkout_enabled:\s*false/);
 assert.match(api,/holds_enabled:\s*false/);
 assert.match(api,/ready_for_sales:\s*false/);
});
test('seat checkout and hold endpoints refuse requests',()=>{
 assert.match(api,/path===['"]\/api\/seats\/hold['"]/);
 assert.match(api,/path===['"]\/api\/seats\/checkout['"]/);
 assert.match(api,/\},423\)/);
});
test('Shopify paid-order endpoint verifies signature',()=>{
 assert.match(api,/verifyHmac\(/);
 assert.match(api,/SHOPIFY_WEBHOOK_SECRET/);
 assert.match(api,/x-shopify-hmac-sha256/);
});
test('Worker routes seat API through server-side handler',()=>{
 assert.match(worker,/handleSeatApi/);
 assert.match(worker,/startsWith\(['"]\/api\/seats\/['"]\)/);
});
test('Cloudflare configuration retains SEAT_DB binding',()=>{
 assert.match(wrangler,/"binding"\s*:\s*"SEAT_DB"/);
});
