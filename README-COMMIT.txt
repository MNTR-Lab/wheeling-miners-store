WHEELING MINERS — TEST ADMIN READINESS REPLACEMENT

Upload the CONTENTS of this ZIP into the repository, preserving folders.
Replace the three existing src/ files in full (no patches).
Add tests/admin-readiness-schema.test.mjs and .github/workflows/wheeling-test-admin-readiness.yml.

Fixes: admin catalog audit, mapping report, and variant manifest previously referenced
section_product_sku, a column absent from the live TEST D1 seats table.
Now derives WM-ST-SEC-<section> in SQL. The manifest excludes the two SOLD
$1 test fixtures and never publishes inventory or enables checkout.

Workflow runs unit checks on push. NO Cloudflare deploy, NO database writes,
NO Shopify changes, NO sales activation. Production is untouched.
