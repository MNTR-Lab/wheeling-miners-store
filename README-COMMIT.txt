WHEELING MINERS — PRODUCTION LOCKDOWN REGRESSION TESTS

Upload ONLY:
  tests/seat-public-lockdown-v130.test.mjs

to the repository tests/ folder. Do not upload this README.

The new tests check public hold and checkout remain disabled, the admin-only
controlled cart is off by default, unauthorized cart requests are denied,
and paid webhook processing refuses missing secret configuration.

No production seat inventory, Shopify products, Worker variables or payments
are modified by these tests. They use in-memory mock database objects.

Expected verification: GitHub Actions 'Wheeling Miners seat safety tests' green.
