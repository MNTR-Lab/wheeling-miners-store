# Production payment verification

Prepared against commit 6a7a99f7c90d0225e4389211d3a744779b5fa7d7.

Upload the ZIP contents to the repository root and preserve .github/workflows,
scripts, and tests. Files are complete replacements or complete new files.
Commit message: Add production payment verification and atomic regression tests

This update does not change src, Wrangler configuration, activation flags,
Shopify inventory, webhook registration, or either deployed Worker. Its paths
do not trigger the existing guarded TEST Worker deployment workflow.

## Validation

794 Node tests passed locally, including 32 new production verification tests.
Production payment tests use an in-memory SQLite database with real SQL batch
transactions and mocked Shopify responses. They cover two-seat commits,
duplicate deliveries, incorrect stores/signatures, missing approval flags,
late payment, delayed delivery of an in-window payment, forged payload payment
timestamps, competing orders/reservations, and rollback after a race.
These are offline checks; they are not evidence of a real production payment.

## After committing

In GitHub Actions, select "Wheeling production payment audit (read-only)" and
choose Run workflow on main. It is manual and does not deploy anything.

It uses the existing repository secrets CLOUDFLARE_TEST_API_TOKEN,
CLOUDFLARE_ACCOUNT_ID, WM_SHOPIFY_CLIENT_ID, WM_SHOPIFY_CLIENT_SECRET, and the
repository variable WM_SHOPIFY_PRODUCTION_STORE_DOMAIN. The production store
must be 186815-4c.myshopify.com. The existing Cloudflare token must allow reading
production Worker settings. The audit reports failure if this access is missing;
it does not change token permissions.

The signed probe uses WM_SHOPIFY_CLIENT_SECRET because app-managed Shopify
webhooks are signed with that app's client secret. A different Worker webhook
secret, incorrect environment/store, or an older deployment will fail the probe.
Do not change a secret merely to make this check green; inspect the failing
configuration first.

The audit checks production database identity, required binding names, absence
of activation flags, actual closed public hold/checkout endpoints, unsigned
request rejection, a signed no-seat request, and rejection of TEST/unrelated
shop headers. No probe contains ticket SKUs or creates a reservation.

It then runs the existing subscription script in verify mode only. A missing
subscription fails; this workflow never registers one. Production must remain
closed throughout. It cannot verify encrypted binding values directly; the
signed probe verifies environment/store routing and the HMAC secret together.
Presence of Worker client credential bindings does not prove those credentials
can authenticate or have read_orders permission.

The existing production readiness audit now defaults to the fixed production
Worker URL when its URL variable is missing, so a green run can no longer skip
live hold/checkout lock checks. An unexpected URL is rejected.

## Current read-only findings

The production Worker settings inspected on October 25, 2026 had the expected
D1 binding and Shopify credential/environment binding names. No sales or
fulfillment activation flags were present. Environment/store values were
secret bindings, so their contents were not inspected. No live signed probe,
real payment, gateway/tax check, production deploy, or sales activation was
performed while preparing this update.

A successful audit still does not establish payment gateway/tax correctness,
storefront publication, actual Worker Admin credential validity, or successful
real-payment fulfillment. Review those before launch.
