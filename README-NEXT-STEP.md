# Wheeling Miners — Receipt QR phase 3 (TEST ONLY)

This is a complete-file replacement package. It preserves existing seat checkout and signed Shopify paid webhook logic. It adds an **optional staff-created customer QR receipt**, not automatic Shopify email delivery.

## Upload/commit files (preserve paths)
- `src/worker.js` (full replacement)
- `src/seat-admin.js` (full replacement)
- `src/seat-receipt-qr.js` (new)
- `ticket-receipt.html` (new)
- `receipt-qr-admin.html` (new)
- `qr-local.js` (new; self-contained QR rendering, no external CDN)
- `migrations/002-seat-receipt-qr.sql` (new; do not execute until instructed)

## After commit
1. Execute `migrations/002-seat-receipt-qr.sql` in **TEST D1 ONLY** (`wheeling-miners-seats-test`, ID `2a06b7a7-e833-4a01-8667-2f6388dc0ee0`).
2. Deploy the latest code using `npx wrangler deploy --config wrangler.test.jsonc` **from a current GitHub checkout**.
3. Open `/receipt-qr-admin.html`, enter the existing admin token and a paid test order ID, then create a receipt. A secure random receipt URL and printable QR are generated. A new QR cannot be generated while one is active; revoke first.
4. Customer opens `/ticket-receipt.html#code=...` and sees seats and physical issuance status, **without purchaser PII or Shopify order ID**.
5. Staff scan the QR, select **Authorized staff: resolve receipt**, authenticate on the QR admin page, resolve the receipt, then use existing staff verification page to issue physical tickets.

## Safety/limitations
- TEST only; do not use real customers or enable public sales.
- QR receipt is NOT admission and is NOT identity verification.
- One QR per paid Shopify order, even for multiple seats.
- Receipt URL is returned only once on creation; share privately with purchaser.
- Automatic customer delivery via Shopify is **not implemented**. This phase supports staff-created and manually delivered QR receipts only.
- Receipt is a bearer credential; if compromised, revoke and reissue.
- Existing seat payment webhook, seat reservation, and checkout behavior are unchanged.
- Brand palette here is a temporary neutral charcoal/gold pending exact approved team assets; do not claim official branding approval.
