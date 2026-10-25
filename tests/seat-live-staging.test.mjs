import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../assets/seat-live.js',import.meta.url),'utf8');
test('selector only reads section inventory and cannot invoke sale endpoints',()=>{
 assert.match(src,/fetch\(`\/api\/seats\/section\/\$\{section\}`/);
 assert.doesNotMatch(src,/\/api\/seats\/(?:hold|checkout|admin|webhooks)/);
 assert.match(src,/button\.disabled=true/);
 assert.match(src,/data\.checkout_enabled!==false/);
 assert.match(src,/seen\.has\(seat\.sku\)/);
});
