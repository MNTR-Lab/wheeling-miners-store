Wheeling Miners test database schema setup

Upload .github/workflows/wheeling-test-schema-deploy.yml into the SAME PATH in GitHub and commit.

Then GitHub > Actions > Wheeling TEST D1 schema setup > Run workflow > Run workflow.

The workflow explicitly checks the test Worker configuration and targets the test D1 database ID 2a06b7a7-e833-4a01-8667-2f6388dc0ee0. It does not deploy production or publish Shopify products.

Only run it after confirming CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID GitHub secrets are set. The workflow uses the account ID already present in the repository's read-only diagnostic.

Expected: successful schema creation, five named tables, and test_seats = 0.
