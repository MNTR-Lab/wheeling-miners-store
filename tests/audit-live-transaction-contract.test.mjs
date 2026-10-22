import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditTransactionContract} from '../tools/audit-live-transaction-contract.mjs';
const names=['seat-reservation-transaction.js','seat-paid-commit.js','seat-checkout-linkage.js','seat-fulfillment-transaction.js','seat-reservation-core.js'];
function fixture(overrides={}){const root=mkdtempSync(join(tmpdir(),'wm-contract-'));mkdirSync(join(root,'src'));for(const n of names)writeFileSync(join(root,'src',n),overrides[n]??'// safe placeholder');return root;}
test('clean contract is ready',()=>{const root=fixture();try{assert.equal(auditTransactionContract(root).ready,true)}finally{rmSync(root,{recursive:true,force:true})}});
test('missing created_at is detected',()=>{const root=fixture({'seat-reservation-transaction.js':"INSERT INTO reservations (id,status,checkout_nonce,expires_at)"});try{assert.ok(auditTransactionContract(root).issues.includes('RESERVATION_CREATED_AT_REQUIRED_BUT_NOT_INSERTED'))}finally{rmSync(root,{recursive:true,force:true})}});
test('invalid paid status is detected',()=>{const root=fixture({'seat-paid-commit.js':"UPDATE reservations SET status='PAID'"});try{assert.ok(auditTransactionContract(root).issues.includes('PAID_STATUS_NOT_IN_PRODUCTION_RESERVATION_ENUM'))}finally{rmSync(root,{recursive:true,force:true})}});
test('ISO versus integer expiry is detected',()=>{const root=fixture({'seat-checkout-linkage.js':'Date.parse(reservation.expires_at)'});try{assert.ok(auditTransactionContract(root).issues.includes('OWNERSHIP_EXPECTS_ISO_EXPIRY_BUT_PRODUCTION_USES_INTEGER'))}finally{rmSync(root,{recursive:true,force:true})}});
