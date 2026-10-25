#!/usr/bin/env node
/** Read-only, dependency-free Wheeling Miners launch audit. No API requests or writes. */
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const checks=[];
function check(name,ok,detail,severity='BLOCKER'){checks.push({name,status:ok?'PASS':severity,detail});}
let test,prod;
try{test=JSON.parse(read('wrangler.test.jsonc'));prod=JSON.parse(read('wrangler.jsonc'));}catch(e){console.error('Cannot read Wrangler configuration:',e.message);process.exit(2)}
check('Separate TEST Worker',test.name==='wheeling-miners-store-test','TEST worker must have its own name');
check('TEST environment marker',test.vars?.WM_ENVIRONMENT==='TEST','WM_ENVIRONMENT=TEST required');
check('TEST D1 binding',test.d1_databases?.some(x=>x.binding==='SEAT_DB'&&x.database_id==='2a06b7a7-e833-4a01-8667-2f6388dc0ee0'),'Known isolated TEST D1 ID');
check('TEST and production database isolation',!prod.d1_databases?.some(x=>test.d1_databases?.some(y=>x.database_id===y.database_id)),'TEST and production must never share D1');
check('TEST Shopify isolation',test.vars?.SHOPIFY_STORE_DOMAIN==='wheeling-miners-ticket-testing.myshopify.com','Only approved TEST Shopify domain');
check('TEST Worker source',test.main==='src/worker.js'&&exists('src/worker.js'),'Worker source exists');
const worker=read('src/worker.js');
check('Webhook routed before assets',worker.includes('handleShopifyPaidWebhook')&&worker.indexOf('handleShopifyPaidWebhook(request,env)')<worker.indexOf('env.ASSETS.fetch(request)'),'Signed webhook must reach Worker');
check('Admin endpoints authenticated',read('src/seat-admin.js').includes('if(!authorized(request,env))'),'Admin bearer guard present (static check only)');
check('Receipt QR is not admission',read('src/seat-receipt-qr.js').includes('NOT an admission credential'),'Pickup QR cannot be used as gate admission');
check('Physical issuance schema',exists('migrations/001-seat-ticket-issuance.sql')||fs.readdirSync(path.join(root,'migrations')).some(x=>x.includes('issuance')),'Ticket issuance migration present (verify applied separately)','REVIEW');
check('Pickup QR schema',exists('migrations/002-seat-receipt-qr.sql'),'Pickup QR migration present (verify applied separately)','REVIEW');
check('Box office hub',exists('box-office-hub.html'),'Box office hub deployed through assets');
check('Reconciliation UI',exists('box-office-reconciliation.html'),'Staff reconciliation UI');
check('Ticket verification UI',exists('receipt-verification.html'),'Physical ticket issuance UI');
check('Pickup QR UI',exists('ticket-receipt.html')&&exists('receipt-qr-admin.html'),'Customer pickup receipt and staff tool');
const api=read('src/seat-api.js');
check('Public checkout remains gated',api.includes("path==='/api/seats/checkout'")&&api.includes('423'),'Public checkout is intentionally locked','REVIEW');
check('Public holds remain gated',api.includes("path==='/api/seats/hold'")&&api.includes('423'),'Public seat holds intentionally locked','REVIEW');
check('Actual admission credential system',false,'Physical tickets / pickup QR are not digital admission tickets; confirm gate process','REVIEW');
check('Production D1 backup evidence',false,'Obtain documented production backup before any migration','REVIEW');
check('Approved ticket prices and venue manifest',false,'Get team/venue approval of prices, sections, seat numbering','REVIEW');
check('Production refund and transfer handling',false,'Document tested refund, cancellation, and seat reassignment process','REVIEW');
check('Production Shopify release authorization',false,'Explicit authorization needed before inventory release and public checkout','REVIEW');
const totals=checks.reduce((o,c)=>(o[c.status]=(o[c.status]||0)+1,o),{});
console.log('\nWHEELING MINERS — READ-ONLY LAUNCH AUDIT\n');
for(const c of checks)console.log(`[${c.status.padEnd(7)}] ${c.name}\n          ${c.detail}`);
console.log('\nSUMMARY',JSON.stringify(totals));
console.log('No API requests made. No databases, Shopify inventory, or Workers modified.');
process.exitCode=totals.BLOCKER?1:0;
