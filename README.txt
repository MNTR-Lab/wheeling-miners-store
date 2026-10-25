Wheeling Miners — webhook test fixture compatibility update

Replace the two files under tests/ with these complete versions.
No production source files are changed.

The live-transition test uses a mock Shopify Admin API to verify paid status and transaction timestamp without network calls or real payments.
The replay regression test now supplies the signed TEST Shopify shop-domain header and explicit TEST environment.

Run from your local repository:
node --test tests/seat-webhook-environment.test.mjs tests/seat-shopify-webhook.test.mjs tests/seat-shopify-webhook-v107.test.mjs tests/seat-paid-webhook-replay-regression.test.mjs tests/seat-paid-live-transition-integration.test.mjs

NOTE: The legacy v107 test file may also require migration to the new shop-domain header. Do not enable production checkout based on these tests alone.
