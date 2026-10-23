# Controlled checkout: next integration step

Adds `POST /api/seats/admin/controlled-cart` behind existing `SEAT_ADMIN_TOKEN` authentication and the new explicit `SEAT_CONTROLLED_CART_ENABLED=true` switch. **Leave the switch unset** until an isolated Shopify test catalog, test payment setup, and test reservation are prepared and explicitly approved.

Example JSON: `{ "reservationId": "reservation_123456789012" }`.

The route reads a previously held reservation, its linked variants, and the matching seat snapshots, validates ownership, and invokes the Shopify Storefront cart creator. It cannot create holds, release seats, change inventory, or publish Shopify products. With the switch unset it returns HTTP 423 before reading reservation data or contacting Shopify. Public `/api/seats/hold` and `/api/seats/checkout` remain disabled.

A successful real test still requires a valid existing HELD reservation in an isolated test environment, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, published/purchasable isolated test variants, and Shopify test payments. Do not enable this against production reservations without a separate controlled-test authorization. Cart creation is not proof that Shopify order note attributes reach the paid webhook; verify that in the end-to-end test.
