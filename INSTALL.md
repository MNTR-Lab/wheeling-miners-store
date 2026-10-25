# Wheeling Miners — isolated $1 TEST seat exception

Replace the two existing files in `src/`, add `src/seat-test-price-policy.js`, and add `tests/seat-test-price-policy.test.mjs`. Preserve directory structure.

Only WM-ST-105-B-03 with exact Shopify TEST variant 50944696418361 and $1.00 price receives the narrow exception. Production, other $1 seats, SOLD fixtures, public checkout and holds are unaffected. No D1 writes occur upon commit. After deploying, run the manually triggered GitHub Actions workflow `Wheeling isolated TEST cart (manual, explicit authorization)` with SKU `WM-ST-105-B-03` and confirmation `CREATE TEST CART WM-ST-105-B-03`. Workflow requires configured GitHub secret `WM_TEST_SEAT_ADMIN_TOKEN` and environment `wheeling-test-checkout`.

NOTE: The checkout orchestration can create a reservation before failing at Shopify cart creation. Do not blindly rerun on failure; inspect reservation and reconcile safely first. This package does not enable public sales.
