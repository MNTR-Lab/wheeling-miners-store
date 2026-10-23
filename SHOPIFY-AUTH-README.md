# Wheeling Miners — Shopify Admin authentication verification

Complete-file additions/replacement for the GitHub repo `MNTR-Lab/wheeling-miners-store`.

- `src/seat-shopify-admin-auth.js` — Shopify client-credentials exchange and **read-only** GraphQL shop identity check.
- `src/seat-admin.js` — full replacement, adds authenticated `GET /api/seats/admin/shopify-connection`.
- `tests/seat-shopify-admin-auth.test.mjs` — offline tests.

## After commit

Leave `SEAT_CONTROLLED_CART_ENABLED` **unset**. To allow only the read-only diagnostic endpoint, add `SEAT_SHOPIFY_AUTH_PROBE_ENABLED=true` as a Cloudflare Worker runtime variable. This is not needed until ready to verify. The endpoint additionally requires the existing `SEAT_ADMIN_TOKEN` Bearer header. It never exposes credentials or token values. Do not paste your bearer token into chat.

The probe uses `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_STORE_DOMAIN` already configured in Cloudflare. Shopify client credentials grant works only for apps and stores in the same Shopify organization. If Shopify returns `shop_not_permitted`, the installed app may need a different OAuth authorization flow. Do not work around this by copying credentials into GitHub.

The Admin API connection does **not** supply the separate `SHOPIFY_STOREFRONT_TOKEN` needed for cart checkout. That will be the next setup phase. No Shopify products, payments, reservations, or inventory are modified by this package.
