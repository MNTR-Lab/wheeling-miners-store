# Wheeling Miners — isolated development Worker

This adds a **separate** Wrangler configuration. It does not modify `wrangler.jsonc` or the production Worker/database.

- Development Worker name: `wheeling-miners-store-test`
- Development D1 database: `wheeling-miners-seats-test` (`2a06b7a7-e833-4a01-8667-2f6388dc0ee0`)
- Shopify development store: `wheeling-miners-ticket-testing.myshopify.com`
- Test product: `gid://shopify/Product/10395891761209`
- Test variant: `gid://shopify/ProductVariant/50931850575929`
- SKU: `WM-ST-105-B-01`

## Safety

The test D1 database was created empty. Do not point the production Worker at it, and do not point the test Worker at production D1. No Shopify credentials or webhook secrets are stored in this file. Public holds and checkout are still disabled in `src/seat-api.js`; controlled cart remains off in this configuration.

## Next steps (not yet executed)

1. Review the isolated test schema and migrate **only** the test D1 database. The current transaction code uses integer epoch-millisecond expiry fields; legacy schema inspection helpers still expect text expiry fields and must not be used to create the test schema.
2. Deploy the isolated Worker explicitly using `npx wrangler deploy --config wrangler.test.jsonc`. Do not use an unqualified deployment command.
3. Add Shopify development-store credentials as **secrets on the test Worker only**; do not copy production Shopify secrets.
4. Stage exactly one test seat and reservation with the test variant, then validate test-only Storefront cart and orders/paid webhook handling.
5. Only after test isolation is verified, authorize a temporary controlled-cart test and a Shopify test payment. Do not release production seats.

No checkout or sales activation is authorized by this configuration.
