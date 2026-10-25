/** TEST-only checkout candidate verification. No database writes or cart creation.
 * Intentionally requires a separate explicit launch decision before a live checkout test.
 */
import {validateTestCheckoutSeat} from './wm-test-checkout-preflight.mjs';
const DB='2a06b7a7-e833-4a01-8667-2f6388dc0ee0';
const ACCOUNT='0b83177a971bd8fcfad88ed4e531eb50';
const BASE='https://wheeling-miners-store-test.bikard.workers.dev';
const token=process.env.CLOUDFLARE_TEST_API_TOKEN;
if(!token)throw Error('Missing CLOUDFLARE_TEST_API_TOKEN');
if(process.env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT)throw Error('Wrong Cloudflare account');
async function query(sql){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({sql})});
 const j=await r.json();if(!r.ok||!j.success||!j.result?.[0]?.success)throw Error('TEST D1 read failed');
 return j.result[0].results||[];
}
const rows=await query("SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE status='UNRELEASED' AND hold_id IS NULL AND shopify_order_id IS NULL AND price_cents>100 AND shopify_variant_id IS NOT NULL ORDER BY sku LIMIT 100");
const eligible=[];
for(const seat of rows){try{validateTestCheckoutSeat(seat,{sku:seat.sku,variant:seat.shopify_variant_id});eligible.push(seat)}catch{}}
if(!eligible.length)throw Error('No safe candidate seats for controlled TEST checkout');
const status=await fetch(`${BASE}/api/seats/status`,{signal:AbortSignal.timeout(15000)});
if(!status.ok)throw Error('TEST Worker unavailable');
const live=await status.json();
if(live.mode!=='STAGING'||live.checkout_enabled!==false||live.holds_enabled!==false)throw Error('Public checkout lock not verified');
const seat=eligible[0];
const summary=`## Controlled TEST checkout preflight (READ ONLY)\n\n- Candidate seat: ${seat.sku}\n- Approved ticket price: $${(seat.price_cents/100).toFixed(2)}\n- Shopify variant: ${seat.shopify_variant_id}\n- Eligible candidates inspected: ${eligible.length}\n- Public checkout: disabled (verified)\n- No reservation created; no inventory changed; no cart created; no payment collected.\n\n**Next launch dependency:** verify that this variant is published and has TEST-store inventory, then perform a separately authorized end-to-end test transaction.\n`;
if(process.env.GITHUB_STEP_SUMMARY){const {appendFileSync}=await import('node:fs');appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary)}
console.log(summary);
