/** TEST-only, admin-authenticated isolated reservation creation. Never publicly routed. */
import {prepareReservationTransaction,executeReservationTransaction} from './seat-reservation-transaction.js';
import {isApprovedTestReleasePrice} from './seat-test-price-policy.js';

const HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store'
};

const reply=(body,status=200)=>
  new Response(JSON.stringify(body),{status,headers:HEADERS});

const SKU=/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/;
const SHOP='wheeling-miners-ticket-testing.myshopify.com';

export function validateIsolatedReservation(body,env){
  if(
    env?.WM_ENVIRONMENT!=='TEST' ||
    env?.SHOPIFY_STORE_DOMAIN!==SHOP ||
    env?.SEAT_TEST_RESERVATION_ENABLED!=='true'
  ) throw Error('TEST_RESERVATION_DISABLED');

  if(
    !body ||
    typeof body!=='object' ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(',')!=='confirmation,operator,sku'
  ) throw Error('INVALID_REQUEST');

  if(
    typeof body.sku!=='string' ||
    !SKU.test(body.sku) ||
    ['WM-ST-105-B-01','WM-ST-105-B-02'].includes(body.sku)
  ) throw Error('PROTECTED_SEAT');

  if(
    typeof body.operator!=='string' ||
    body.operator.trim().length<2 ||
    body.operator.length>120 ||
    body.confirmation!==`RESERVE TEST ${body.sku}`
  ) throw Error('CONFIRMATION_REQUIRED');

  return {
    sku:body.sku,
    operator:body.operator.trim()
  };
}

export async function handleTestReservation(
  request,
  env,
  {
    randomUUID=()=>crypto.randomUUID(),
    now=()=>new Date()
  }={}
){
  if(request.method!=='POST')
    return reply({error:'METHOD_NOT_ALLOWED'},405);

  if(
    env?.WM_ENVIRONMENT!=='TEST' ||
    env?.SHOPIFY_STORE_DOMAIN!==SHOP ||
    env?.SEAT_TEST_RESERVATION_ENABLED!=='true'
  ) return reply({error:'TEST_RESERVATION_DISABLED'},423);

  if(!env.SEAT_DB?.prepare || !env.SEAT_DB?.batch)
    return reply({error:'DATABASE_UNAVAILABLE'},503);

  let body;

  try{
    const raw=await request.text();

    if(raw.length>1024)
      return reply({error:'BODY_TOO_LARGE'},413);

    body=JSON.parse(raw);
  }catch{
    return reply({error:'INVALID_JSON'},400);
  }

  let input;

  try{
    input=validateIsolatedReservation(body,env);
  }catch(e){
    return reply({error:e.message},422);
  }

  const {sku}=input;

  const row=await env.SEAT_DB.prepare(
    'SELECT sku,status,hold_id,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE sku=?'
  ).bind(sku).first();

  if(
    !row ||
    row.status!=='AVAILABLE' ||
    row.hold_id!==null ||
    row.shopify_order_id!==null ||
    !isApprovedTestReleasePrice(row,env)
  ) return reply({error:'SEAT_NOT_AVAILABLE'},409);

  const current=now();

  if(
    !(current instanceof Date) ||
    !Number.isFinite(current.valueOf())
  ) return reply({error:'INVALID_CLOCK'},503);

  const reservationId=`wm_test_${randomUUID().replaceAll('-','')}`;
  const checkoutNonce=`wm_nonce_${randomUUID().replaceAll('-','')}`;

  const expiresAt=new Date(current.valueOf()+15*60*1000);

  try{
    // The reservation planner requires an ISO string or epoch timestamp,
    // not a JavaScript Date object.
    const plan=prepareReservationTransaction(
      [sku],
      [row],
      {
        reservationId,
        checkoutNonce,
        expiresAt:expiresAt.toISOString(),
        now:current
      }
    );

    await executeReservationTransaction(
      env.SEAT_DB,
      plan,
      {
        authorized:true,
        now:current
      }
    );

    return reply({
      ok:true,
      mode:'CONTROLLED_TEST_RESERVATION',
      reservationId,
      sku,
      expiresAt:expiresAt.toISOString(),
      adminOnly:true,
      publicCheckoutEnabled:false,
      checkoutUrl:null
    },201);

  }catch(e){
    return reply({
      error:'RESERVATION_CONFLICT',
      detail:e?.message==='SEATS_NOT_AVAILABLE'
        ? 'SEAT_NOT_AVAILABLE'
        : undefined
    },409);
  }
}
