/** Manually authorized TEST-only release -> reserve -> cart. Never processes payment. */
const BASE='https://wheeling-miners-store-test.bikard.workers.dev';
const SHOP='wheeling-miners-ticket-testing.myshopify.com';
const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const PROTECTED=new Set(['WM-ST-105-B-01','WM-ST-105-B-02']);
export function validateControlledRun({sku,confirmation,environment,shop,token}){
 if(environment!=='TEST'||shop!==SHOP)throw Error('TEST_ENVIRONMENT_REQUIRED');
 if(typeof sku!=='string'||!SKU.test(sku)||PROTECTED.has(sku))throw Error('PROTECTED_OR_INVALID_SKU');
 if(confirmation!==`CREATE TEST CART ${sku}`)throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 if(typeof token!=='string'||token.length<32)throw Error('TEST_ADMIN_TOKEN_REQUIRED');
 return sku;
}
export async function runControlledCheckout({sku,confirmation,environment,shop,token,operator='GitHub TEST checkout',fetchImpl=fetch}){
 validateControlledRun({sku,confirmation,environment,shop,token});
 const auth={authorization:`Bearer ${token}`,'content-type':'application/json'};
 async function request(path,body){
  const response=await fetchImpl(`${BASE}${path}`,{method:'POST',headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({error:'NON_JSON_RESPONSE'}));
  if(!response.ok)throw Error(`${path}: ${data.error??'HTTP_'+response.status} (${response.status})`);
  return data;
 }
 const statusResponse=await fetchImpl(`${BASE}/api/seats/status`,{signal:AbortSignal.timeout(20000)});
 if(!statusResponse.ok)throw Error('TEST_STATUS_UNAVAILABLE');
 const status=await statusResponse.json();
 if(status.mode!=='STAGING'||status.checkout_enabled!==false||status.holds_enabled!==false)throw Error('PUBLIC_CHECKOUT_NOT_LOCKED');
 // This endpoint must be separately enabled in TEST Worker settings. Never change settings here.
 const released=await request('/api/seats/admin/test-release',{sku,operator,confirmation:`RELEASE TEST ${sku}`});
 if(released.status!=='AVAILABLE'||released.sku!==sku)throw Error('RELEASE_RESPONSE_INVALID');
 // If a subsequent step fails, leave the seat available/held for explicit reconciliation; never auto-release a cart-linked seat.
 const reservation=await request('/api/seats/admin/test-reservation',{sku,operator,confirmation:`RESERVE TEST ${sku}`});
 if(reservation.sku!==sku||!reservation.reservationId||reservation.publicCheckoutEnabled!==false)throw Error('RESERVATION_RESPONSE_INVALID');
 const cart=await request('/api/seats/admin/controlled-cart',{reservationId:reservation.reservationId});
 if(cart.mode!=='CONTROLLED_CART_ONLY'||cart.reservationId!==reservation.reservationId||cart.seatCount!==1||cart.publicCheckoutEnabled!==false)throw Error('CART_RESPONSE_INVALID');
 const url=new URL(cart.checkoutUrl);
 if(url.protocol!=='https:'||url.hostname!==SHOP)throw Error('UNTRUSTED_CHECKOUT_HOST');
 return {sku,reservationId:reservation.reservationId,expiresAt:reservation.expiresAt,checkoutUrl:cart.checkoutUrl};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
 const sku=process.env.WM_TEST_SKU;
 try{
  const result=await runControlledCheckout({sku,confirmation:process.env.WM_TEST_CONFIRMATION,environment:process.env.WM_ENVIRONMENT,shop:process.env.SHOPIFY_STORE_DOMAIN,token:process.env.WM_TEST_SEAT_ADMIN_TOKEN});
  const {appendFileSync}=await import('node:fs');
  const summary=`## Controlled Shopify TEST cart (no payment performed)\n\nSeat: ${result.sku}  \nReservation: ${result.reservationId}  \nExpires: ${result.expiresAt}  \n[Open TEST checkout](${result.checkoutUrl})\n\n**Use Shopify test payment only. Do not enter a real card.** Verify paid webhook and SOLD transition separately.\n`;
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  console.log('TEST cart created. Open the GitHub Actions run summary for the checkout link.');
 }catch(error){console.error(`Controlled checkout stopped: ${error.message}`);process.exitCode=1}
}
