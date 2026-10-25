# Wheeling Miners — QR receipt safety update (TEST only)

Replace the **entire** `src/seat-receipt-qr.js` in the GitHub repository with the included file. No other files, migrations, or secrets change.

## What changes

- Makes QR creation atomic: two concurrent staff requests cannot silently replace each other's active QR receipt.
- Permits QR revocation even if the order is later refunded or seats are under reconciliation.
- Requires SOLD seats before staff resolve returns an order ID, not just possession of a valid QR.
- Applies no-store/private, no-referrer, and nosniff headers to receipt API responses.
- Limits incoming JSON bodies by UTF-8 byte length, and validates JSON objects.
- Preserves existing endpoint paths and response shapes for the existing receipt admin and customer pages.

## Deployment

After committing the full replacement file, deploy the latest commit to the **TEST Worker only**:

```sh
cd ~/Downloads/wheeling-miners-latest && git pull origin main && npx wrangler deploy --config wrangler.test.jsonc
```

Do not run a migration. Do not deploy to production. Do not redo the $1 paid checkout test.
