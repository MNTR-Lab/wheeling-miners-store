# Production order access verification

Upload these four complete files to the repository, preserving their paths:
- .github/workflows/wheeling-production-order-access.yml
- scripts/wm-production-order-access.mjs
- tests/seat-production-order-access.test.mjs
- PRODUCTION-ORDER-ACCESS-README.md

Commit message: Add read-only production Worker Shopify credential check

This package does not change src, Wrangler configuration, deployed code,
inventory, or sales/fulfillment flags. Its file paths do not trigger the
existing guarded TEST Worker deployment workflow.

Before running:
1. In GitHub repository Settings > Secrets and variables > Actions, add the
   repository secret WM_SEAT_ADMIN_TOKEN using the SAME existing value as
   SEAT_ADMIN_TOKEN for the production wheeling-miners-store Worker.
   Do not rotate the token and do not post it in chat or screenshots.
2. In Cloudflare > Workers & Pages > wheeling-miners-store > Settings >
   Variables and Secrets, add the plain-text variable
   SEAT_SHOPIFY_AUTH_PROBE_ENABLED with the exact value true. Save/deploy that
   setting for the production Worker. This enables only the existing
   authenticated read-only Shopify connection probe, not ticket purchasing.
   Keep sales, controlled-cart, fulfillment, and approval flags absent/off.
3. In GitHub Actions, select Wheeling production order access (read-only),
   choose Run workflow, select main, and run.

The workflow checks sales locks before probing credentials. It tests GitHub
app authentication and read_orders scope, then calls the production Worker's
existing authenticated Shopify connection endpoint. The Worker independently
uses its own stored SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET to authenticate.
The checker requires the expected GOAT store and read_products/read_orders
scopes in both contexts. It then verifies the existing webhook subscription.
No order, payment, inventory, credential, or activation mutation occurs in the
workflow. Tokens and secrets are not printed.

This verifies authentication and scope presence, NOT actual protected order or
transaction reads, real-payment fulfillment, payment gateway/tax correctness,
storefront publication, or launch approval. If the Worker credential check
fails, confirm its client ID and secret belong to the same installed production
Shopify app. Leave the now-working webhook signing secret unchanged.

Read-only inventory checked October 25, 2026: 3,737 seats, 63 sections, 3,737
unique variant mappings, all UNRELEASED, no order/hold links. No writes made.

Validation: 9 new credential-check tests pass, with mocked Shopify and the
existing Worker authentication probe. Full local suite: 806 tests passing.
