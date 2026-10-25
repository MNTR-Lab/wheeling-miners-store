# Wheeling controlled TEST reservation stage

Replace `src/seat-admin.js` with the provided full file and add `src/seat-test-reservation.js` and `tests/seat-test-reservation.test.mjs`.

This endpoint is admin-token protected by the existing seat-admin router, TEST-store only, and disabled unless `SEAT_TEST_RESERVATION_ENABLED=true` is explicitly configured on the TEST Worker. Do not enable it until the separate TEST seat-release step is authorized and Shopify test inventory is prepared. It only holds a previously AVAILABLE seat for 15 minutes; it does not create a Shopify cart, collect payment, enable public checkout, or modify production. The endpoint is POST `/api/seats/admin/test-reservation` with JSON `{ "sku": "...", "operator": "...", "confirmation": "RESERVE TEST ..." }`.

Test: `node --test tests/seat-test-reservation.test.mjs`. No inventory modifications occur on deployment.
