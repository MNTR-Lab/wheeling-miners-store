# Wheeling Miners receipt verification — Phase 2 staff interface

This package adds only `receipt-verification.html` to the repository root. It does not change checkout, Shopify products, Workers, inventory, or database state.

## Install
Upload `receipt-verification.html` to the repository root, then commit. On the TEST Worker static assets deployment, open `/receipt-verification.html`.

## Requirements before using the issuance button
1. Phase 1 code must be deployed on the TEST Worker.
2. `migrations/001-seat-ticket-issuance.sql` must be applied to the TEST D1 database only. Do NOT run on production.
3. Authorized staff need the existing `SEAT_ADMIN_TOKEN` to call protected APIs.
4. Staff must independently confirm the customer's receipt/identity. A numeric Shopify order ID alone does NOT prove the presenter owns the order.

## Limits
- This is a staff-facing lookup and handoff screen, NOT a public QR generator or buyer delivery integration.
- Staff token is kept in tab memory only, not browser storage.
- The issuance action is irreversible in this phase; supervisor reversal workflow should be designed separately.
- Never publish staff admin token in HTML, GitHub, QR code, or screenshots.
- Production public sales remain disabled.
