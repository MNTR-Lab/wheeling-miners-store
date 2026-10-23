V126 combined corrective release for V125. Replace BOTH complete files:
src/seat-complete-purchase-rehearsal.js
tests/seat-complete-purchase-v125.test.mjs

Fixes two mismatches revealed by CI: reservation planner must receive exactly the selected inventory rows; paid-commit ownership verification expects `sku` on reservation seats, not `seat_sku`. This ZIP supersedes the earlier V125 correction. Does not enable public checkout, mutate D1, or interact with Shopify. Run GitHub Actions after commit; tests have not yet been verified.
