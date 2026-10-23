WHEELING MINERS — STOREFRONT / CONTROLLED CHECKOUT PREFLIGHT

This package contains one ADDITIVE test file. It does not enable checkout, release seats, modify D1, publish products, or alter Shopify.

Copy tests/seat-storefront-connection.test.mjs into the existing repository's tests/ folder.
Commit that file to GitHub. Existing files should remain unchanged.

The tests validate: read-only Storefront API query, no secret leakage, default-off diagnostic, method rejection, bad domain handling, Shopify GraphQL error handling, and administrator authentication.

Run in the repository root:
  node --test tests/seat-storefront-connection.test.mjs

NOTE: The test imports ../src/seat-shopify-storefront-auth.js and ../src/seat-admin.js from your existing repo. It will not run in this ZIP by itself.

NEXT PHASE AFTER TESTS PASS:
- Prepare isolated Shopify test variant and test payment method.
- Prepare a valid isolated HELD reservation linked to the test variant.
- Explicitly authorize any controlled cart test before enabling SEAT_CONTROLLED_CART_ENABLED.
- Keep all production seats UNRELEASED.
