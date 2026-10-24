/** TEST ONLY: signed paid webhook against a uniquely named temporary Worker and D1 fixture. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const ACCOUNT='0b83177a971bd8fcfad88ed4e531eb50';
const DB='2a06b7a7-e833-4a01-8667-2f6388dc0ee0';
const TEST_STORE='wheeling-miners-ticket-testing.myshopify.com';
const TOKEN=process.env.CLOUDFLARE_API_TOKEN;
const SECRET=process.env.WM_TEST_WEBHOOK_SECRET;
const ensure=(x,msg)=>{if(!x)throw Error(msg)};
const cfg=JSON.parse(readFileSync('wrangler.test.jsonc','utf8'));
function preflight(){
 ensure(process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT,'Wrong Cloudflare account');
 ensure(TOKEN&&SECRET,'Missing TEST secrets');
 ensure(cfg.name==='wheeling-miners-store-test'&&cfg.vars?.WM_ENVIRONMENT==='TEST','Wrong test Worker config');
 ensure(cfg.vars?.SHOPIFY_STORE_DOMAIN===TEST_STORE,'Wrong Shopify test store');
 ensure(cfg.vars?.SEAT_PAID_FULFILLMENT_ENABLED!=='true','Existing TEST Worker gate must remain OFF');
 ensure(cfg.d1_databases?.length===1&&cfg.d1_databases[0].database_id===DB,'Wrong test D1');
 console.log('PASS: production and existing TEST Worker excluded');
}
if(process.argv[2]==='preflight'){preflight();process.exit(0)}
ensure(process.argv[2]==='run','Usage: node scripts/wm-e2e-paid-worker.mjs preflight|run');
preflight();
const suffix=randomBytes(6).toString('hex');
const worker=`wm-paid-e2e-${suffix}`;
const sku=`WM-ST-999-Z-${String(parseInt(suffix.slice(0,2),16)%90+10)}`;
const rid=`wm_e2e_${suffix}_reservation_2026`;
const nonce=`wm_e2e_checkout_nonce_${suffix}_2026`;
const orderId=String(90000000000000n+BigInt('0x'+suffix));
const variantId=String(90000000000000n+BigInt('0x'+suffix));
const variant=`gid://shopify/ProductVariant/${variantId}`;
const tmp=mkdtempSync(join(tmpdir(),'wm-e2e-'));
const workerConfig=join(tmp,'wrangler.e2e.json');
const url=`https://${worker}.bikard.workers.dev/api/seats/webhooks/shopify`;
let deploymentAttempted=false,seeded=false;
function wrangler(args,{input}={}){
 const r=spawnSync('npx',['--yes','wrangler@4',...args],{encoding:'utf8',input,env:process.env,timeout:120000});
 if(r.status!==0)throw Error(`wrangler ${args[0]} failed: ${(r.stderr||r.stdout).slice(-1200)}`);
 return r.stdout;
}
async function cf(path,method='GET'){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,{
  method,headers:{Authorization:`Bearer ${TOKEN}`,'content-type':'application/json'}});
 let data;try{data=await r.json()}catch{data={}}
 return {status:r.status,data};
}
async function deleteTemporaryWorker(){
 ensure(/^wm-paid-e2e-[a-f0-9]{12}$/.test(worker),'Refusing to delete unexpected Worker name');
 // Use the Workers Scripts API directly. Wrangler delete also enumerates KV namespaces,
 // which the narrow test token cannot access.
 const path=`/workers/scripts/${encodeURIComponent(worker)}`;
 const result=await cf(path,'DELETE');
 if(!((result.status>=200&&result.status<300)||result.status===404)){
  throw Error(`Temporary Worker deletion failed HTTP ${result.status}: ${JSON.stringify(result.data).slice(0,400)}`);
 }
 const check=await cf(path,'GET');
 if(check.status!==404)throw Error(`Temporary Worker still accessible (GET HTTP ${check.status})`);
 console.log('PASS: temporary Worker deleted and absence verified');
}
async function sql(query){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,{
 method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({sql:query})});
 const data=await r.json();
 if(!r.ok||data.success!==true||data.result?.[0]?.success!==true)throw Error(`TEST D1 SQL failure: ${JSON.stringify(data).slice(0,700)}`);
 return data.result[0].results;
}
async function request(order){
 const body=JSON.stringify(order);
 const sig=createHmac('sha256',SECRET).update(body).digest('base64');
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-shopify-topic':'orders/paid','x-shopify-hmac-sha256':sig},body});
 return {status:r.status,body:await r.json()};
}
const order={id:orderId,line_items:[{sku,variant_id:variantId,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
try{
 const count=await sql(`SELECT COUNT(*) AS n FROM seats WHERE sku='${sku}' OR shopify_variant_id='${variant}'`);
 ensure(count[0].n===0,'Fixture seat collision');
 const now=Date.now(),expires=now+20*60*1000;
 await sql(`INSERT INTO seats (sku,section,row_label,seat_number,price_cents,status,hold_id,hold_expires_at,shopify_variant_id) VALUES ('${sku}','TEST','Z',99,100,'HELD','${rid}',${expires},'${variant}')`);
 seeded=true;
 await sql(`INSERT INTO reservations (id,status,created_at,checkout_nonce,expires_at) VALUES ('${rid}','CHECKOUT_PENDING',${now},'${nonce}',${expires})`);
 await sql(`INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id) VALUES ('${rid}','${sku}','${variant}')`);
 const isolated={...cfg,name:worker,vars:{...cfg.vars,SEAT_PAID_FULFILLMENT_ENABLED:'true'}};
 delete isolated.assets;
 isolated.main=join(process.cwd(),'src/worker.js');
 writeFileSync(workerConfig,JSON.stringify(isolated,null,2));
 deploymentAttempted=true;
 wrangler(['deploy','--config',workerConfig]);
 // Use the exact same isolated configuration for deployment and secret installation.
 // Passing --name alone can cause Wrangler to target a different configuration.
 wrangler(['secret','put','SHOPIFY_WEBHOOK_SECRET','--config',workerConfig],{input:SECRET+'\n'});
 // Check the binding's name only. Never log or compare the secret's value.
 const secretOutput=wrangler(['secret','list','--config',workerConfig,'--format','json']);
 let bindings;
 try { bindings=JSON.parse(secretOutput); }
 catch { throw Error('Unable to parse temporary Worker secret listing'); }
 ensure(Array.isArray(bindings)&&bindings.some(x=>x.name==='SHOPIFY_WEBHOOK_SECRET'&&x.type==='secret_text'),
  'Temporary Worker webhook secret binding missing after installation');
 console.log('PASS: webhook signing secret binding installed on isolated Worker');
 const first=await request(order);
 ensure(first.status===200&&first.body?.ok===true&&first.body.replayed===false,`First paid commit failed: ${JSON.stringify(first)}`);
 const state=await sql(`SELECT status,shopify_order_id,hold_id FROM seats WHERE sku='${sku}'`);
 const reservation=await sql(`SELECT status,shopify_order_id FROM reservations WHERE id='${rid}'`);
 ensure(state[0]?.status==='SOLD'&&String(state[0].shopify_order_id)===orderId&&state[0].hold_id===null,'Seat was not SOLD correctly');
 ensure(reservation[0]?.status==='CONFIRMED'&&String(reservation[0].shopify_order_id)===orderId,'Reservation was not CONFIRMED correctly');
 console.log('PASS: signed Worker webhook transitioned actual TEST D1 seat and reservation');
 const replay=await request(order);
 ensure(replay.status===200&&replay.body?.replayed===true,'Replay was not idempotent');
 const competitor=await request({...order,id:String(BigInt(orderId)+1n)});
 ensure(competitor.status===503,'Competing order was not rejected');
 console.log('PASS: replay accepted without duplicate sale; competing order rejected');
 const after=await sql(`SELECT status,shopify_order_id FROM seats WHERE sku='${sku}'`);
 ensure(after[0]?.status==='SOLD'&&String(after[0].shopify_order_id)===orderId,'Seat ownership changed unexpectedly');
 console.log('PASS: real D1 order ownership unchanged');
}finally{
 const errors=[];
 if(deploymentAttempted)try{await deleteTemporaryWorker()}catch(e){errors.push(String(e))}
 if(seeded){
  for(const statement of [
   `DELETE FROM reservation_seats WHERE reservation_id='${rid}'`,
   `DELETE FROM reservations WHERE id='${rid}'`,
   `DELETE FROM seats WHERE sku='${sku}'`
  ])try{await sql(statement)}catch(e){errors.push(String(e))}
  if(!errors.length){
   try{
    const left=await sql(`SELECT (SELECT COUNT(*) FROM seats WHERE sku='${sku}')+(SELECT COUNT(*) FROM reservations WHERE id='${rid}')+(SELECT COUNT(*) FROM reservation_seats WHERE reservation_id='${rid}') AS n`);
    ensure(left[0]?.n===0,'Fixture records remain');
    console.log('PASS: temporary TEST D1 fixture removed');
   }catch(e){errors.push(String(e))}
  }
 }
 rmSync(tmp,{recursive:true,force:true});
 if(errors.length)throw Error(`Cleanup incomplete: ${errors.join('; ')}`);
 console.log('PASS: isolated fixture and temporary Worker cleanup completed');
}
