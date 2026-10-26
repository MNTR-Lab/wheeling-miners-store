# Production launch package

This commit prepares launch; it does not turn on sales or release stock.

## GitHub

Upload all package contents, preserving folders, and commit. Wait for the safety tests and Cloudflare production build to succeed. TEST source files are unchanged.

## Shopify confirmation email

In GOAT Sports Inc: Settings → Notifications → Customer notifications → Order confirmation → Edit code.

Keep the existing confirmation template. Copy the complete contents of `production/shopify-order-confirmation-party.liquid` immediately before its closing `</body>` tag, then save. Shopify sends this block only when the server-created `wm_pickup_receipt_url` order attribute has the exact expected origin and path. Ordinary merchandise confirmations have no block. Use Shopify's preview to check the template syntax before saving; the default sample may not contain the ticket attribute and may hide the block.

The link opens the QR only after the reservation is CONFIRMED and all linked seats are SOLD to the same verified Shopify order. Unpaid orders receive a pending message, not a QR. Tokens stay in the URL fragment and are exchanged by POST. Staff revocation is respected. Keep the Shopify webhook signing secret unchanged; rotating it requires ticket-office reissuance of existing derived receipts.

## Final release, performed after deployment and notification installation

1. Reconcile current Shopify stock, orders, and D1. Close expired controlled-test holds without changing paid seats. Keep all sales flags off during preparation.
2. Use `approved-seat-release.json` as the exclusive seat allowlist: 3,737 unique SKUs, exact Shopify variant IDs, and approved prices. Exclude all 67 old placeholder variants. Read current quantities before release and compare expected 0 → 1.
3. Prepare the 63 section products as UNLISTED with the Headless publication so tickets are purchased through the seat selector. Preserve merchandise settings. Do not activate the obsolete level products or archived duplicate.
4. Release matching pristine D1 seats from UNRELEASED to AVAILABLE in a guarded atomic operation. Verify all counts and prices again.
5. Set the five production sales/fulfillment approvals only when everything above passes; keep both controlled-test flags false. Verify public status, availability, and checkout through the deployed production code. No paid test purchase is authorized by this package.
6. The approved public route is `/season-tickets.html`; home-page section links now point to it. The `/seat-selector.html` staff mapping preview remains separate.

## Customer and staff flow

Shopify confirmation → private pickup receipt link → verified QR → staff scanner at the Ticket Release Party → confirm customer identity and paid seats → hand over physical tickets → record issuance once. QR is not admission. Party details will be announced separately.

## Checks

Run `node --test tests/*.test.mjs`. The offline public purchase test covers hold, private Shopify cart attributes, custom checkout domain, independently verified mock Shopify payment, atomic seat sale, duplicate webhook, and QR claim. No external network or card charge is used in that test. Actual live payment-to-webhook behavior is still not independently proven by a completed paid ticket order.

Abandoned public holds are reclaimed every five minutes only while production sales are enabled, after a 15-minute grace period beyond reservation expiry. Paid or reassigned seats are never released by that job. Exceptionally delayed payments require reconciliation rather than overwriting a competing reservation.
