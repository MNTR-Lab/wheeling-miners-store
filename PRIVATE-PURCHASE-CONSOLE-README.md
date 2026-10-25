# Private production purchase console

Upload these four complete files preserving production and tests:
- production/worker.js
- production-controlled-checkout.html (repository root)
- tests/seat-controlled-production.test.mjs
- PRIVATE-PURCHASE-CONSOLE-README.md

Commit message: Add authenticated private production checkout console

No Wrangler configuration changes are required. The production entry point
already uses production/worker.js. The TEST entry point and guarded TEST deploy
workflow are unchanged. No activation variables are enabled by this package.

## Required Shopify channel correction before staging stock

Product: Wheeling Miners | Season Tickets | Section 301
Product ID: 10333279879337
Store: GOAT / 186815-4c.myshopify.com

During the authorized staging attempt, status ACTIVE revealed existing
publication assignments beyond Headless, including Online Store. Inventory
stayed zero for every variant. The connector refused publishableUnpublish,
so the product was restored to DRAFT and remains at zero stock. No seat was
released/reserved and no payment was made.

In Shopify Admin, open this Section 301 product and use Publishing / Sales
channels and apps > Manage. Leave only Goat Sports Inc Headless selected;
deselect Online Store and every other channel/app. Save. Then set this product
ACTIVE and save, still with zero stock. Channel names and controls can vary by
Shopify screen; verify the assigned channel list before changing status.

Do not add stock or activate the controlled gate yet. The assistant will
independently recheck publication assignments after the correction. Only the
approved seat will receive quantity 1 when the private test is ready.

## Console after deployment and staging

https://wheeling-miners-store.bikard.workers.dev/production-controlled-checkout.html

The console is restricted to this exact production origin. Enter the existing
production admin token and operator name; the token stays in this tab only.
The read-only status endpoint reports the configured seat and reservation
without returning the checkout nonce or any Shopify credentials.

After staging is confirmed:
1. Check seat state.
2. Type RESERVE PRODUCTION TEST WM-ST-301-L2-01 and acknowledge real production
   checkout. Reserve one seat. This requires the server's narrow gate to be on.
3. Create private checkout, then open the link in a separate tab.
4. Review the $65 seat and actual checkout taxes/fees before payment.
5. Complete payment manually, return, and check state. Expected: seat SOLD,
   reservation CONFIRMED, and matching order IDs.

The link is rendered privately in your authenticated browser tab, not in a
public GitHub Actions log. Do not share the admin token or checkout link.
No payment is triggered by reserve, create cart, check state, or deploy.

If a request times out after reserve, use Check seat state to recover a still
valid reservation before trying again. Do not make another payment if seat
fulfillment is delayed. Gate expiry does not automatically release a held seat
or refund an order; reconcile that explicitly.

## Validation

26 controlled tests pass, including SQLite atomicity and authenticated status
checks. Full local suite: 841 tests passing. Console JavaScript syntax checked.
Shopify variant and D1 candidate remain priced at $65. The live seat is not
released or reserved; all Section 301 inventory is zero and product is DRAFT.
