# Wheeling V112: D1 expiry and confirmed reservation compatibility

Upload **complete replacements** to matching repository paths:

- `src/seat-expiry.js` (new)
- `src/seat-checkout-linkage.js` (replace)
- `src/seat-fulfillment-transaction.js` (replace)
- `tests/seat-expiry-v112.test.mjs` (new)

No database changes. No checkout routes, inventory release, or product publishing.

This increment corrects D1 INTEGER expiry handling and CONFIRMED replay semantics in ownership/fulfillment modules. The reservation creation/hold planner still needs V113 to store integer expiry and created_at. Do not enable checkout. Older test fixtures may still assume PAID and need updating as part of the coordinated V113 test migration.

Run: `node --test tests/seat-expiry-v112.test.mjs`
