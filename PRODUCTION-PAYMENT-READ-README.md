# Read an existing production payment without writes

Upload all four files preserving .github/workflows, scripts, and tests.
The YAML is a complete replacement for the existing order-access workflow.
Commit message: Verify actual production paid-order and transaction reads

Then run GitHub Actions > Wheeling production order access (read-only) >
Run workflow > main. Leave the optional order_id field blank to select an
existing paid order. If selection finds no paid order, the run stops rather
than claiming success; supply a recent existing paid order's numeric Shopify
ID if needed. This is its URL/API ID, not the # order display number.
Do not create or pay an order for this read-only check.

The workflow retains the previously passing lock, Worker authentication,
order-scope, and webhook-subscription checks. Its final step uses the existing
GitHub app credentials to read one paid order and its transactions through the
same API version and REST requests used by the deployed paid webhook. It
checks paid status, successful sale/capture, and usable payment timestamp.
It does not print the order ID, amounts, customer information, or tokens.
Only the token exchange uses POST; all order/transaction requests are GET.

This proves real order/transaction reads for the GitHub app credentials. It
does not prove these reads using the Worker's encrypted credentials, nor
reservation linkage or actual production ticket fulfillment. The preceding
Worker probe separately verifies that Worker's authentication and scopes.
Those limits remain explicit in the output. A controlled payment-to-seat test
is still required before launch.

No new secrets or Cloudflare settings are required. No src, Wrangler config,
inventory, activation flags, or deployments are changed. These paths do not
trigger the guarded TEST Worker deployment workflow. Public sales stay closed.

Validation: 9 new mocked payment-read tests, 815 local Node tests passing,
JavaScript syntax and workflow YAML checks passed.

Official endpoint references:
https://shopify.dev/docs/api/admin-rest/2026-10/resources/order
https://shopify.dev/docs/api/admin-rest/2026-10/resources/transaction
