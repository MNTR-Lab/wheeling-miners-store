# Production webhook integration — guarded, NOT enabled

Replace `src/seat-shopify-webhook.js` and add `tests/seat-production-webhook-gating.test.mjs`.
Do not change Wrangler production flags, secrets, Shopify settings, D1 inventory, or public sales flags.

Run:
`node --test tests/seat-production-webhook-gating.test.mjs tests/seat-webhook-environment.test.mjs`

This removes the TEST-only hardcoded Shopify domain from paid-order verification, but requires the existing environment guard to authorize the store and **both** production approval flags before automatic fulfillment. Webhook HMAC, Shopify Admin paid-status verification, paid timestamp verification, and guarded D1 batch remain in place.

IMPORTANT: Production sales are not launch-ready merely because this code is merged. Expired holds, payment-after-expiry, inventory mapping, and end-to-end production readiness must still be verified. Keep production flags OFF until explicitly approved.
