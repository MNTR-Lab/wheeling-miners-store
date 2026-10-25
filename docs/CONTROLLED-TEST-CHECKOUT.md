# Wheeling Miners — controlled TEST checkout

This batch installs a manually triggered orchestration workflow; it **does not enable it** or alter inventory. It does not process payment or enable public sales.

## Prerequisites before running

1. Obtain explicit authorization to run an isolated Shopify TEST checkout. Never use either historical SOLD fixture.
2. Verify `WM_TEST_SEAT_ADMIN_TOKEN` exists in the GitHub Actions `wheeling-test-checkout` environment. Configure required reviewers on that environment before use.
3. Confirm the Worker `SEAT_TEST_RELEASE_ENABLED` and `SEAT_TEST_RESERVATION_ENABLED` flags are deliberately enabled in TEST only. Both are disabled if absent. Do not enable them in production.
4. Verify the selected Shopify TEST variant is published to the TEST sales channel and has sufficient TEST inventory. This code does not publish products or adjust Shopify stock.
5. The public checkout and holds must remain disabled.

## Run

GitHub Actions → **Wheeling isolated TEST cart (manual, explicit authorization)** → Run workflow. Supply the exact approved test SKU and `CREATE TEST CART <SKU>` as confirmation. Reviewers approve if configured. The workflow first verifies public checkout is locked, then releases one seat, creates a 15-minute reservation, and requests a Shopify TEST cart. The cart URL appears in the run summary.

**Important:** If a step fails after release or reservation, do not rerun with the same SKU without inspecting TEST D1. A partial test may leave an AVAILABLE or HELD seat. No automatic cleanup is performed because that could accidentally release a seat linked to a payment.

Use Shopify TEST payment only. Confirm that the signed `orders/paid` webhook has processed and that the exact seat transitions to SOLD once; confirm replay does not duplicate fulfillment. Do not open sales until end-to-end payment, webhook, inventory and expiry tests pass.
