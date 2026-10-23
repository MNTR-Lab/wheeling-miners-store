Wheeling Miners — isolated test Worker deployment

Commit .github/workflows/wheeling-test-worker-deploy.yml into the same path in the repository.
Then GitHub > Actions > Wheeling TEST Worker deployment > Run workflow.

The workflow checks that the test schema exists BEFORE deploying. If the schema setup was not run, it stops safely.
The test Worker is separate from production, uses the test D1 database, and keeps checkout disabled.
No Shopify secrets are added and no test payment is attempted.

If GitHub Actions reports a missing Cloudflare token or D1 schema, do not run production deployment workflows to fix it.
