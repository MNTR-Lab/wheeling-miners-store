import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../seat-payment-preview.html',import.meta.url),'utf8');
test('operator preview uses authenticated read-only endpoint',()=>{assert.match(html,/\/api\/seats\/admin\/ownership-preview/);assert.match(html,/authorization:'Bearer '\+token/);assert.match(html,/method:'POST'/);});
test('preview never calls public checkout, hold, or fulfillment endpoints',()=>{assert.doesNotMatch(html,/fetch\(['"]\/api\/seats\/(checkout|hold|webhooks)/);assert.doesNotMatch(html,/localStorage|sessionStorage|document\.cookie/);});
test('operator sees explicit payment and fulfillment disclaimers',()=>{assert.match(html,/Payment verified: NO/);assert.match(html,/Fulfillment executed: NO/);assert.match(html,/Sales remain disabled/);});
