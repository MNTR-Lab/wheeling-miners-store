/** Authenticated, controlled Shopify Storefront cart creation.
 * Requires explicit server-side enablement. Never releases inventory or publishes products.
 * Shopify draft/zero-inventory variants will not be purchasable; use approved isolated test stock.
 */
import {verifyCheckoutHandoff} from './seat-checkout-handoff.js';
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/;
const HOST=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MUTATION=`mutation CreateSeatCart($input: CartInput!) { cartCreate(input: $input) { cart { id checkoutUrl attributes { key value } lines(first: 10) { nodes { id quantity merchandise { ... on ProductVariant { id } } } } } userErrors { field message code } } }`;
const fail=code=>{throw Error(code)};
export function buildSeatCartInput(handoff){
 if(!handoff||handoff.mode!=='READ_ONLY_CHECKOUT_HANDOFF'||handoff.ownershipVerified!==true||handoff.variantMappingVerified!==true)fail('UNVERIFIED_HANDOFF');
 if(!Array.isArray(handoff.lineItems)||handoff.lineItems.length!==handoff.seatCount||handoff.seatCount<1||handoff.seatCount>8)fail('INVALID_SEAT_LINES');
 if(!Array.isArray(handoff.noteAttributes)||handoff.noteAttributes.length!==2)fail('INVALID_CHECKOUT_ATTRIBUTES');
 const attrs=new Map(handoff.noteAttributes.map(x=>[x?.name,x?.value]));
 if(attrs.size!==2||!/^[-_A-Za-z0-9]{16,128}$/.test(attrs.get('wm_reservation_id')??'')||!/^[-_A-Za-z0-9]{24,128}$/.test(attrs.get('wm_checkout_nonce')??''))fail('INVALID_CHECKOUT_ATTRIBUTES');
 if(attrs.get('wm_reservation_id')!==handoff.reservationId)fail('RESERVATION_LINK_MISMATCH');
 const variants=new Set(),skus=new Set();
 const lines=handoff.lineItems.map(x=>{
  if(x.quantity!==1||!GID.test(x.merchandiseId)||typeof x.sku!=='string'||!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(x.sku))fail('INVALID_SEAT_LINES');
  if(variants.has(x.merchandiseId)||skus.has(x.sku))fail('DUPLICATE_SEAT_LINES');
  variants.add(x.merchandiseId);skus.add(x.sku);
  return {merchandiseId:x.merchandiseId,quantity:1};
 });
 return {lines,attributes:[{key:'wm_reservation_id',value:attrs.get('wm_reservation_id')},{key:'wm_checkout_nonce',value:attrs.get('wm_checkout_nonce')}]};
}
export async function createControlledSeatCart({reservation,linkedSeats,seatRows,env,fetchImpl=fetch,now=new Date()}){
 if(env?.SEAT_CONTROLLED_CART_ENABLED!=='true')fail('CONTROLLED_CART_DISABLED');
 const shop=env?.SHOPIFY_STORE_DOMAIN,token=env?.SHOPIFY_STOREFRONT_TOKEN;
 if(typeof shop!=='string'||!HOST.test(shop)||typeof token!=='string'||token.length<10)fail('SHOPIFY_STOREFRONT_NOT_CONFIGURED');
 const handoff=verifyCheckoutHandoff(reservation,linkedSeats,seatRows,{now});
 const input=buildSeatCartInput(handoff);
 const response=await fetchImpl(`https://${shop}/api/2026-10/graphql.json`,{method:'POST',headers:{'content-type':'application/json','Shopify-Storefront-Private-Token':token},body:JSON.stringify({query:MUTATION,variables:{input}})});
 if(!response?.ok)fail('SHOPIFY_CART_HTTP_ERROR');
 const result=await response.json();
 if(result?.errors?.length||result?.data?.cartCreate?.userErrors?.length)fail('SHOPIFY_CART_REJECTED');
 const cart=result?.data?.cartCreate?.cart;
 if(typeof cart?.checkoutUrl!=='string'||!cart.checkoutUrl.startsWith(`https://${shop}/`))fail('UNTRUSTED_CHECKOUT_URL');
 const actual=new Map((cart.lines?.nodes??[]).map(x=>[x?.merchandise?.id,x?.quantity]));
 if(actual.size!==input.lines.length||input.lines.some(x=>actual.get(x.merchandiseId)!==1))fail('SHOPIFY_CART_LINE_MISMATCH');
 const actualAttrs=new Map((cart.attributes??[]).map(x=>[x.key,x.value]));
 if(input.attributes.some(x=>actualAttrs.get(x.key)!==x.value))fail('SHOPIFY_CART_ATTRIBUTE_MISMATCH');
 return {mode:'CONTROLLED_CART_ONLY',reservationId:reservation.id,checkoutUrl:cart.checkoutUrl,cartId:cart.id,seatCount:input.lines.length,publicCheckoutEnabled:false,inventoryChanged:false};
}
