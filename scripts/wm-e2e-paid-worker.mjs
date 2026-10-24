/** TEST-only end-to-end signed paid webhook probe. No production writes. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const ACCOUNT='0b83177a971bd8fcfad88ed4e531eb50';
const DB='2a06b7a7-e833-4a01-8667-2f6388dc0ee0';
const TOKEN=process.env.CLOUDFLARE_API_TOKEN;
const SECRET=process.env.WM_TEST_WEBHOOK_SECRET;
const check=(v,msg)=>{if(!v)throw Error(msg)};
const config=JSON.parse(readFileSync('wrangler.test.jsonc','utf8'));
function preflight(){
 check(process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT,'Unexpected Cloudflare account');
 check(TOKEN&&SECRET,'Missing TEST credentials');
 check(config.name==='wheeling-miners-store-test'&&config.vars?.WM_ENVIRONMENT==='TEST','Wrong test configuration');
 check(config.vars?.SHOPIFY_STORE_DOMAIN==='wheeling-miners-ticket-testing.myshopify.com','Wrong Shopify test store');
 check(config.vars?.SEAT_PAID_FULFILLMENT_ENABLED!=='true','Existing TEST Worker must remain fulfillment-disabled');
 check(config.d1_databases?.length===1&&config.d1_databases[0].database_id===DB,'Wrong D1 database');
 console.log('PASS: Isolated TEST configuration');
}
if(process.argv[2]==='preflight'){preflight();process.exit(0)}
check(process.argv[2]==='run','Usage: node scripts/wm-e2e-paid-worker.mjs preflight|run');
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
const endpoint=`https://${worker}.bikard.workers.dev/api/seats/webhooks/shopify`;
let fixtureStarted=false,deployAttempted=false;
function wrangler(args,{input}={}){
 const p=spawnSync('npx',['--yes','wrangler@4',...args],{encoding:'utf8',input,env:process.env,timeout:120000});
 if(p.status!==0)throw Error(`wrangler ${args[0]} failed: ${(p.stderr||p.stdout).slice(-1500)}`);
 return p.stdout;
}
async function api(method,path,body){
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,{
  method,headers:{Authorization:`Bearer ${TOKEN}`,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const data=await response.json().catch(()=>({}));
 return {status:response.status,ok:response.ok&&data.success===true,data};
}
async function sql(statement){
 const r=await api('POST',`/d1/database/${DB}/query`,{sql:statement});
 if(!r.ok||r.data.result?.[0]?.success!==true)throw Error(`TEST D1 query failed: ${JSON.stringify(r.data).slice(0,700)}`);
 return r.data.result[0].results;
}
async function webhook(payload){
 const body=JSON.stringify(payload);
 const signature=createHmac('sha256',SECRET).update(body).digest('base64');
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-shopify-topic':'orders/paid','x-shopify-hmac-sha256':signature},body});
 return {status:response.status,body:await response.json()};
}
const order={id:orderId,line_items:[{sku,variant_id:variantId,quantity:1}],note_attributes:[{name:'wm_reservation_id',value:rid},{name:'wm_checkout_nonce',value:nonce}]};
let failure;
try{
 const collision=await sql(`SELECT COUNT(*) AS n FROM seats WHERE sku='${sku}' OR shopify_variant_id='${variant}'`);
 check(collision[0].n===0,'Fixture collision; refusing to overwrite');
 const now=Date.now(),expiry=now+20*60*1000;
 fixtureStarted=true;
 await sql(`INSERT INTO seats (sku,section,row_label,seat_number,price_cents,status,hold_id,hold_expires_at,shopify_variant_id) VALUES ('${sku}','TEST','Z',99,100,'HELD','${rid}',${expiry},'${variant}')`);
 await sql(`INSERT INTO reservations (id,status,created_at,checkout_nonce,expires_at) VALUES ('${rid}','CHECKOUT_PENDING',${now},'${nonce}',${expiry})`);
 await sql(`INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id) VALUES ('${rid}','${sku}','${variant}')`);
 const isolated={...config,name:worker,vars:{...config.vars,SEAT_PAID_FULFILLMENT_ENABLED:'true'}};
 delete isolated.assets;
 isolated.main=join(process.cwd(),'src/worker.js');
 writeFileSync(workerConfig,JSON.stringify(isolated,null,2));
 deployAttempted=true;
 wrangler(['deploy','--config',workerConfig]);
 wrangler(['secret','put','SHOPIFY_WEBHOOK_SECRET','--name',worker],{input:SECRET+'\n'});
 const first=await webhook(order);
 check(first.status===200&&first.body?.ok===true&&first.body.replayed===false,`First webhook failed: ${JSON.stringify(first)}`);
 const seat=await sql(`SELECT status,shopify_order_id,hold_id FROM seats WHERE sku='${sku}'`);
 const reservation=await sql(`SELECT status,shopify_order_id FROM reservations WHERE id='${rid}'`);
 check(seat[0]?.status==='SOLD'&&String(seat[0].shopify_order_id)===orderId&&seat[0].hold_id===null,'Seat transition failed');
 check(reservation[0]?.status==='CONFIRMED'&&String(reservation[0].shopify_order_id)===orderId,'Reservation transition failed');
 console.log('PASS: Signed webhook updated real TEST D1');
 const replay=await webhook(order);
 check(replay.status===200&&replay.body?.replayed===true,'Idempotent replay failed');
 const competing=await webhook({...order,id:String(BigInt(orderId)+1n)});
 check(competing.status===503,'Competing order should be rejected');
 const after=await sql(`SELECT status,shopify_order_id FROM seats WHERE sku='${sku}'`);
 check(after[0]?.status==='SOLD'&&String(after[0].shopify_order_id)===orderId,'Seat ownership changed');
 console.log('PASS: Replay and competing-order protection');
}catch(error){failure=error;console.error('TEST FAILED:',error.message)}
finally{
 const errors=[];
 if(fixtureStarted){
  for(const q of [`DELETE FROM reservation_seats WHERE reservation_id='${rid}'`,`DELETE FROM reservations WHERE id='${rid}'`,`DELETE FROM seats WHERE sku='${sku}'`]){
   try{await sql(q)}catch(error){errors.push(`Fixture cleanup: ${error.message}`)}
  }
 }
 if(deployAttempted){
  // Cloudflare Workers Scripts API avoids Wrangler's unrelated KV namespace discovery.
  // DELETE only the unique temporary Worker; never the original TEST or production Worker.
  try{
   const r=await api('DELETE',`/workers/scripts/${worker}`);
   if(!r.ok&&r.status!==404)throw Error(`HTTP ${r.status}: ${JSON.stringify(r.data).slice(0,500)}`);
   const checkDeletion=await api('GET',`/workers/scripts/${worker}`);
   if(checkDeletion.ok||checkDeletion.status!==404)throw Error(`Worker deletion not verified (HTTP ${checkDeletion.status})`);
   console.log('PASS: Temporary Worker deletion verified');
  }catch(error){errors.push(`Worker cleanup: ${error.message}`)}
 }
 rmSync(tmp,{recursive:true,force:true});
 if(errors.length)failure=new Error([failure?.message,...errors].filter(Boolean).join(' | '));
 else console.log('PASS: TEST fixture cleanup completed');
}
if(failure)throw failure;
console.log('PASS: End-to-end TEST complete; production unchanged');
