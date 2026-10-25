WHEELING MINERS — PAYMENT-SAFETY LAUNCH GATE

This replaces src/seat-public-checkout.js and adds tests/seat-public-launch-gate.test.mjs.

Why: the old public checkout activation gate allowed the checkout to open even when
production paid-order fulfillment was disabled. This update requires BOTH systems
and their independent approvals to be configured before accepting public holds.

This does NOT activate production sales. It does NOT change Shopify, D1, or secrets.

Upload both files to the same paths in GitHub, commit together.
Then locally run:
  cd "$HOME/Downloads/wheeling-miners-fresh" && git pull origin main && node --test tests/seat-public-launch-gate.test.mjs tests/seat-public-checkout.test.mjs

Do NOT enable production sales until payment-to-seat mapping, concurrency and
production Shopify variant availability have been verified.
