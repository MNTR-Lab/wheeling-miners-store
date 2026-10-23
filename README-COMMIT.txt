Wheeling Miners isolated checkout rehearsal

Upload ONLY tests/seat-isolated-cart-rehearsal.test.mjs into the repository's tests/ folder.
This test uses an in-memory mock Shopify response and synthetic seat/reservation fixtures.
It does NOT contact Shopify, write D1, change Shopify inventory, or enable checkout.
The production SEAT_CONTROLLED_CART_ENABLED flag must remain unset.

GitHub Actions runs node --test tests/*.test.mjs on the next commit.
