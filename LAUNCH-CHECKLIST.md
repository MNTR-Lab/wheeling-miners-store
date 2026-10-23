# Wheeling Miners assigned-seat season tickets — controlled launch checklist

## Verified in GitHub Actions before V128
- V127: 603 automated tests passing and five additional checks.
- 3,737 seats mapped to 63 sections; all currently unreleased.
- Draft Shopify catalog and zero Shopify inventory, not public sales.

## Still requires independent execution and evidence
- [ ] Team/venue approval evidence recorded and signed.
- [ ] Confirm production D1 backup and migration state; verify Shopify variant IDs and prices against live drafts.
- [ ] Configure a separate approved controlled testing environment or explicitly approved small test inventory; do not change production inventory without authorization.
- [ ] Run a real controlled Shopify checkout and payment, verify reservation note attributes and webhook signature.
- [ ] Verify atomic SOLD transition, idempotent webhook replay, and simultaneous competing purchases.
- [ ] Verify cancellation, refund, manual reassignment, and reconciliation procedures.
- [ ] Confirm operational rollback, customer support, fulfillment, and incident response.
- [ ] Obtain explicit authorization before publishing products, releasing seats, enabling holds, or enabling checkout.

V128 assessment is read-only. Passing automated tests is not equivalent to a completed live payment test or approval to sell.
