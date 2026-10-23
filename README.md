# Controlled Shopify cart integration (first implementation step)

Add complete files `src/seat-shopify-cart.js` and `tests/seat-shopify-cart.test.mjs`.

This is an **admin-only integration primitive**, not a public endpoint. It builds an actual Shopify Storefront API `cartCreate` request from a verified D1-held reservation, validates the returned cart lines and reservation attributes, and returns the checkout URL. It does not change D1, Shopify inventory, product visibility, or worker routing.

Before live testing: separately configure a suitable isolated Shopify test store or approved test products/stock, valid Storefront API access token, and test payment mode. Draft products with zero inventory cannot be purchased. `SEAT_CONTROLLED_CART_ENABLED` defaults off; setting it to `true` alone does not expose a route. Never expose this function publicly without adding authentication, replay protection, and a controlled checkout workflow.

IMPORTANT: Shopify cart attributes must be verified to persist to `orders/paid` `note_attributes` in the real integration. Do not enable fulfillment or live sales until that test passes. The checkout URL returned by this primitive is not authorization to release seats.
