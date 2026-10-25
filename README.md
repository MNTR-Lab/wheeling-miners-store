# Wheeling Miners — Customer Checkout UI (fail-closed)

Copy the included `season-tickets.html`, `src/seat-public-inventory.js`, `src/worker.js`, and `tests/seat-public-inventory.test.mjs` to the corresponding paths in the repository. **Replace `src/worker.js` in full.** Keep the existing `src/seat-public-checkout.js` and all other files.

This adds a customer-facing page at `/season-tickets.html`, public read-only inventory endpoints, and tests. In TEST, public sales remain closed and no public D1 seat inventory is returned. Production sales remain disabled unless separately and explicitly approved via production Worker configuration, verified catalog/inventory, and operational sign-off.

Test locally (from your fresh clone):

`node --test tests/seat-public-inventory.test.mjs tests/seat-public-checkout.test.mjs`

Do **not** enable sales flags or publish production inventory as part of this commit. This is not a launch authorization.

**Important limitation:** A 15-minute D1 hold is not by itself sufficient to guarantee checkout completion within that period. Shopify carts are separate from D1 inventory and may remain payable after a hold expires. Before launch, the payment/hold expiry reconciliation and refund/oversell procedure require end-to-end validation. This page is not the final approval to accept real orders.
