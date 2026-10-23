import test from 'node:test';
import assert from 'node:assert/strict';
import {expiryMilliseconds} from '../src/seat-expiry.js';
test('integer epoch milliseconds',()=>assert.equal(expiryMilliseconds(1792700000000),1792700000000));
test('integer epoch seconds',()=>assert.equal(expiryMilliseconds(1792700000),1792700000000));
test('legacy ISO fixture',()=>assert.equal(expiryMilliseconds('2026-10-22T00:00:00.000Z'),Date.parse('2026-10-22T00:00:00.000Z')));
test('rejects malformed expiry',()=>assert.throws(()=>expiryMilliseconds('tomorrow'),/INVALID_EXPIRY/));
test('rejects null expiry',()=>assert.throws(()=>expiryMilliseconds(null),/INVALID_EXPIRY/));
