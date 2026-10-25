# Production paid-webhook activation guard (preparatory update)

This commit introduces a standalone, fail-closed authorization module and tests.
It intentionally does **not** modify `src/seat-shopify-webhook.js` or activate production payment fulfillment.

Production paid-order commits must require:
- `WM_ENVIRONMENT=PRODUCTION`
- A valid production `SHOPIFY_STORE_DOMAIN` (not the TEST store)
- `SEAT_PAID_FULFILLMENT_ENABLED=true`
- `SEAT_PRODUCTION_PAID_COMMIT_APPROVED=true`
- `SEAT_PUBLIC_SALES_APPROVED=true`

These flags must not be enabled until production inventory, Shopify webhooks,
refund handling, and expiration/late-payment recovery have been verified.

Next integration step: replace the webhook's hard-coded TEST store with a validated
store selected by `paidWebhookStore(env)` and use `paidWebhookCommitEnabled(env,orderId)`
for the commit gate. Ensure all Shopify Admin API requests and the signed shop header
use the validated store. Add integration tests for rejected cross-store signatures,
late paid transactions, replay, and duplicate fulfillment before activation.

Run: `node --test tests/seat-webhook-environment.test.mjs`
