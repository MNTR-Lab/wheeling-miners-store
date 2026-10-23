# Wheeling V111: paid-commit database enum fix (staging only)

Copy both files into matching paths in the GitHub repository `MNTR-Lab/wheeling-miners-store`, replacing `src/seat-paid-commit.js` and adding `tests/seat-paid-commit-v111.test.mjs`.

Run `node --test tests/seat-paid-commit-v111.test.mjs` in the repository.

**Important:** This is one isolated fix, NOT checkout-ready. Existing V105 tests still assert `PAID` and will need updating in the next coordinated compatibility batch. Reservation expiry, hold expiry, and created_at contract remain unresolved. No production DB migrations, seat release, inventory, products, or checkout changes are included. Do not activate sales.
