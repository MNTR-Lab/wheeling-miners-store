# Wheeling Miners — Public checkout candidate (DISABLED)

This package is intentionally **not enabled**. It adds two server-side routes behind strict flags, using existing D1 atomic reservation and Shopify cart functions. It does not publish Shopify products, release seats, or modify production data.

## Files
- `src/seat-public-checkout.js` (new)
- `tests/seat-public-checkout.test.mjs` (new)
- `src/worker.js` (complete replacement)

## Before any production enablement
- Independently verify production D1 migrations and backup, 3,737 seats and 63 sections, Shopify variant mappings, prices and seat inventory.
- Validate concurrent reservations, abandoned checkout expiry and cleanup, paid webhook, refunds, cancelled orders, ticket pickup and customer support.
- Implement and verify public checkout abuse/rate limits, expiry recovery, and Shopify inventory parity; test under isolated staging configuration.
- Obtain explicit team approval and authorization for production release.
- Only then configure `WM_ENVIRONMENT=PRODUCTION`, `SEAT_PUBLIC_SALES_ENABLED=true`, `SEAT_PUBLIC_SALES_APPROVED=true`, `SEAT_CONTROLLED_CART_ENABLED=true`, and the **correct approved production** Shopify domain and secrets. Do not set any of these now.

The public checkout candidate is NOT launch-ready. These routes are a guarded foundation, not approval to sell.

## Tests
`node --test tests/seat-public-checkout.test.mjs`
