/** Read-only production readiness gate. Never enables checkout or changes inventory. */
const ACCOUNT = '0b83177a971bd8fcfad88ed4e531eb50';
const DB = '221e3797-3ea2-477d-9a7f-7dfded620547';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
assert(process.env.CLOUDFLARE_ACCOUNT_ID === ACCOUNT, 'Incorrect Cloudflare account');
assert(typeof TOKEN === 'string' && TOKEN.length > 0, 'Missing Cloudflare token');
const {readFileSync} = await import('node:fs');
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
assert(config.name === 'wheeling-miners-store', 'Unexpected production Worker');
assert(config.d1_databases?.length === 1 && config.d1_databases[0].database_id === DB, 'Unexpected production database');
assert(config.vars?.SEAT_PAID_FULFILLMENT_ENABLED !== 'true', 'Production fulfillment enabled in repository config');
async function query(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
    method:'POST', headers:{Authorization:`Bearer ${TOKEN}`, 'content-type':'application/json'},
    body:JSON.stringify({sql})
  });
  const body = await response.json();
  assert(response.ok && body.success && body.result?.[0]?.success, `Read-only D1 query failed: ${response.status}`);
  return body.result[0].results;
}
const [summary] = await query(`SELECT COUNT(*) AS total,COUNT(DISTINCT sku) AS unique_skus,COUNT(DISTINCT shopify_variant_id) AS unique_variants,COUNT(DISTINCT section) AS sections,SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,SUM(CASE WHEN status!='UNRELEASED' THEN 1 ELSE 0 END) AS released,SUM(CASE WHEN shopify_variant_id IS NULL OR TRIM(shopify_variant_id)='' THEN 1 ELSE 0 END) AS unmapped,SUM(CASE WHEN price_cents IS NULL OR price_cents<=0 THEN 1 ELSE 0 END) AS invalid_prices,MIN(price_cents) AS min_price,MAX(price_cents) AS max_price FROM seats`);
assert(summary.total===3737, `Expected 3737 seats, got ${summary.total}`);
assert(summary.unique_skus===3737 && summary.unique_variants===3737, 'Duplicate SKU or variant mapping');
assert(summary.unreleased===3737 && summary.released===0, 'Production inventory is not fully unreleased');
assert(summary.unmapped===0 && summary.invalid_prices===0, 'Missing mappings or invalid prices');
console.log(`PASS: ${summary.total} unreleased seats, ${summary.unique_variants} unique mapped variants, ${summary.sections} sections`);
console.log(`PASS: D1 prices $${(summary.min_price/100).toFixed(2)}–$${(summary.max_price/100).toFixed(2)} (Shopify prices not yet independently verified)`);
const [reservations] = await query('SELECT COUNT(*) AS n FROM reservations');
assert(reservations.n===0, `Production reservations exist: ${reservations.n}`);
console.log('PASS: no production reservations');
const [badVariants] = await query("SELECT COUNT(*) AS n FROM seats WHERE shopify_variant_id NOT GLOB 'gid://shopify/ProductVariant/[1-9]*' OR shopify_variant_id IS NULL");
assert(badVariants.n===0, 'Malformed Shopify variant GIDs');
console.log('PASS: variant IDs have Shopify GID format');
const base = process.env.WM_PRODUCTION_WORKER_URL || 'https://wheeling-miners-store.bikard.workers.dev';
if (base) {
  const origin = new URL(base);
  assert(base==='https://wheeling-miners-store.bikard.workers.dev'||base==='https://wheeling-miners-store.bikard.workers.dev/', 'Invalid production Worker URL');
  async function check(path,method='GET') {
    const response = await fetch(new URL(path,origin), {method,headers:method==='POST'?{'content-type':'application/json'}:{},body:method==='POST'?'{}':undefined});
    return {status:response.status, body:await response.json()};
  }
  const status = await check('/api/seats/status');
  assert(status.status===200 && status.body.checkout_enabled===false && status.body.holds_enabled===false, 'Public seat status is not locked');
  for(const path of ['/api/seats/hold','/api/seats/checkout']) {
    const result=await check(path,'POST');
    assert(result.status===423, `${path} is not locked (${result.status})`);
  }
  console.log('PASS: deployed production Worker public hold and checkout endpoints locked');
}
console.log('PASS: read-only D1 production inventory checks complete');
console.log('NOT VERIFIED: Shopify Admin product existence, actual Shopify prices, active webhook subscription, or Worker runtime secrets');
