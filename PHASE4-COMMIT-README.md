# Phase 4 — isolated TEST controlled-cart alignment

Commit all four replacement files together to MNTR-Lab/wheeling-miners-store at their exact paths.

This preserves the successful admin-only test cart setting across future TEST Worker deployments, and aligns preflight and reservation-refresh workflows with that setting.

**No production files, production seats, public holds, public checkout, or paid fulfillment are enabled or changed.**

After committing, wait for the automatic `Wheeling Miners seat safety tests` run. Do not redeploy merely to apply this source-code alignment; the live TEST Worker already has this setting enabled.
