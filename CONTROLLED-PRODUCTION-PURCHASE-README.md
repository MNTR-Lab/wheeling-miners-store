# One-seat production controlled purchase

Upload all four complete files and preserve production and tests folders:
- wrangler.jsonc (repository root; complete replacement)
- production/worker.js (new production-only entry point)
- tests/seat-controlled-production.test.mjs
- CONTROLLED-PRODUCTION-PURCHASE-README.md

Commit message: Add disabled-by-default single-seat production purchase rehearsal

The production config now uses production/worker.js. TEST stays on src/worker.js;
no existing src files or wrangler.test.jsonc are changed. These paths do not
trigger the existing guarded TEST Worker deployment workflow. The production
Git-connected deployment will pick up this new entry point. The persistent
read-only auth probe setting is retained.

## State after deployment

Controlled purchasing is OFF. No controlled-test variables are added to the
configuration. No seats are released/reserved and no Shopify product or stock
is changed. Existing webhook behavior is unchanged with the new gate off.
The complete purchase rehearsal is NOT yet verified live.

## Proposed candidate, not yet released or approved for a charge

Read-only D1 candidate found October 25, 2026:
- SKU: WM-ST-301-L2-01
- Section: 301
- Price: $65.00 / 6500 cents
- Variant: gid://shopify/ProductVariant/51444239990953
- Status: UNRELEASED, no hold/order

Recheck both D1 and Shopify immediately before staging. Shopify variant SKU,
price, stock tracking/quantity, publication to the headless channel, and checkout
availability must be inspected. Do not increase stock, publish a whole section,
change product prices, enable a store-wide test gateway, or create a real charge
merely by committing this package. Any existing payment-read success used an
unrelated existing paid order and is not evidence of this seat's checkout.

## Narrow activation configuration (later, after seat review)

On the production Worker only, all of these are required together:
- SEAT_PRODUCTION_CONTROLLED_TEST_ENABLED = true
- SEAT_PRODUCTION_CONTROLLED_TEST_APPROVED = true
- SEAT_PRODUCTION_CONTROLLED_SKU = exact approved seat SKU
- SEAT_PRODUCTION_CONTROLLED_RESERVATION_ID = wm_control_ plus 32 lowercase hex characters
- SEAT_PRODUCTION_CONTROLLED_PRICE_CENTS = exact approved positive integer cents
- SEAT_PRODUCTION_CONTROLLED_TEST_UNTIL = future ISO timestamp, no more than one hour ahead

Do not add these yet. Generate a fresh reservation ID and short deadline when
ready to run, and store controlled variables as a managed deployment config so
they are not silently lost on redeployment. Never commit admin or Shopify secrets.

These broad flags must stay absent/off during the rehearsal:
SEAT_PUBLIC_SALES_ENABLED, SEAT_PUBLIC_SALES_APPROVED,
SEAT_CONTROLLED_CART_ENABLED, SEAT_PAID_FULFILLMENT_ENABLED,
SEAT_PRODUCTION_PAID_COMMIT_APPROVED.

## Private admin sequence after activation

Both endpoints require Authorization: Bearer <existing production admin token>.
Never paste the token into chat, commit it, or publish a private checkout URL.
1. POST /api/seats/admin/production-test-reservation with JSON:
   {"confirmation":"RESERVE PRODUCTION TEST <exact approved SKU>","operator":"<operator name>"}
2. This atomically creates a 15-minute (or shorter) reservation and moves only
   the configured pristine UNRELEASED seat to HELD. It does not expose a public
   AVAILABLE interval. The configured price and variant mapping must match.
   A conflict rolls back the entire batch. It returns reservationId and expiry.
3. POST /api/seats/admin/production-test-cart with JSON:
   {"reservationId":"<configured reservation ID>"}
4. It creates a private Shopify cart for that held seat only and returns its
   checkout URL. The human purchaser reviews tax/total and completes checkout.
   No automatic payment/capture occurs in these endpoints.
5. The signed paid-order webhook receives invocation-local fulfillment
   permission only for the exact configured seat AND reservation. All original
   Shopify verification, payment-time, nonce, variant/ownership, atomic commit,
   and replay checks still run. Other seat orders receive no such permission.
6. Verify seat SOLD, matching order/reservation CONFIRMED, duplicate webhook
   delivery idempotent, and the intended customer receipt/pickup process.
   Receipt QR is not an admission credential; this package does not add automatic
   receipt email or gate-admission delivery. Confirm those separately.

The code enforces the reservation and payment rules, but a private Shopify cart
is not a channel-level guarantee against direct purchase. Keep public stock and
publication restricted and inspect any existing product links before staging.

Disable the two controlled-test switches after verification. Expiry stops new
controlled fulfillment; it does not automatically refund payments, release an
expired held seat, reverse a SOLD seat, or restore Shopify inventory. Reconcile
any late payment/conflict before cleanup. Do not refund/restock independently
and assume D1 changed. Preserve evidence for the one reservation and order.

## Validation

24 new offline tests include real isolated SQLite transactions and mocked
Shopify responses. They exercise narrow signed fulfillment, replay, wrong
seat/reservation, multiple seats, missing approvals, time limits, invalid HMAC,
nonce, late payment, competing hold rollback, atomic reservation creation,
duplicate reservation rollback, price/auth failures, private cart creation,
and public endpoint locks even with conflicting broad flags.

Full local suite: 839 tests passing. No production inventory mutation, payment,
activation, or deployment was performed while preparing this package.
