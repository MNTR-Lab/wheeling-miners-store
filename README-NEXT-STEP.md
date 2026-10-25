# Wheeling Miners — Receipt Verification Phase 1

## Included
- `src/seat-receipt-verification.js`: staff-only paid-order lookup and one-time ticket issuance, with duplicate issuance blocked.
- `migrations/001-seat-ticket-issuance.sql`: TEST-only tables to record physical ticket handoff and audit trail.
- `src/seat-admin.js`: complete replacement, integrating two routes behind existing bearer-token authorization.

## What to do
1. Upload the ZIP's `src/` files into the GitHub repository, preserving paths; commit.
2. **Do not run the SQL yourself yet.** The migration must be applied to the TEST D1 database `2a06b7a7-e833-4a01-8667-2f6388dc0ee0` before exercising issuance endpoints. Never run it against production `221e3797-3ea2-477d-9a7f-7dfded620547`.
3. The new endpoints are `GET /api/seats/admin/receipt-lookup?order_id=...` and `POST /api/seats/admin/receipt-issue`. Both require existing `SEAT_ADMIN_TOKEN` authentication.

## Not yet implemented
- QR code creation and delivery to purchaser.
- A staff-facing browser page with secure sign-in.
- Production enablement.

The new lookup confirms the order's SOLD status from the existing verified Shopify paid webhook, not by trusting a customer-provided receipt. Never treat an arbitrary order number as proof of ownership.
