import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/seat-live.js',import.meta.url),'utf8');
test('live seat overlay remains fail-closed after preview rerenders',()=>{
 assert.match(source,/MutationObserver\(mutations\s*=>/);
 assert.match(source,/disablePreview\(\)/);
 assert.match(source,/if\(!unguarded\)return/);
 assert.match(source,/queueMicrotask\(/);
 assert.match(source,/grid\.replaceChildren\(fragment\)/);
 assert.match(source,/button\.disabled=true/);
 assert.match(source,/data\.checkout_enabled!==false/);
 assert.doesNotMatch(source,/\/api\/seats\/(?:hold|checkout)/);
});
