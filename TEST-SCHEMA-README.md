# Test database schema — not production

Upload `data/staging/test-seat-schema.sql` into that exact repository path.

This file is deliberately not auto-applied by a GitHub workflow. It is for the isolated D1 database `wheeling-miners-seats-test` (ID `2a06b7a7-e833-4a01-8667-2f6388dc0ee0`) only.

When authorized and verified, apply with:

`npx wrangler d1 execute wheeling-miners-seats-test --remote --config wrangler.test.jsonc --file data/staging/test-seat-schema.sql`

Do not run the command against production. No seat is released or made available by this schema. The Shopify test product remains draft with zero inventory.
