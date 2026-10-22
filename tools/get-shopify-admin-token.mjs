/** Exchange installed Shopify app client credentials for a short-lived Admin API token. */
import { appendFileSync } from 'node:fs';
const { SHOPIFY_SHOP_DOMAIN: domain, SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret, GITHUB_ENV: envFile } = process.env;
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain || '')) throw Error('Invalid Shopify shop domain');
if (!clientId || !clientSecret || !envFile) throw Error('Missing GitHub secrets or environment');
const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
const response = await fetch(`https://${domain}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
if (!response.ok) throw Error(`Shopify token exchange failed (HTTP ${response.status}). Check that the app is installed on this store and credentials are correct.`);
const payload = await response.json();
if (typeof payload.access_token !== 'string' || !payload.access_token) throw Error('Shopify did not return an access token');
console.log(`::add-mask::${payload.access_token}`);
appendFileSync(envFile, `SHOPIFY_ADMIN_TOKEN=${payload.access_token}\n`, { mode: 0o600 });
console.log('Shopify Admin API token obtained securely for this workflow run.');
