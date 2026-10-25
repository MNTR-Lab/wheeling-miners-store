# Wheeling Miners — Launch Audit (read only)

Add `scripts/launch-readiness-audit.mjs` to the repository's `scripts` folder. This is a **local-only, dependency-free audit**. It never contacts Shopify or Cloudflare and never modifies any environment.

Run from your local repo:

```bash
node scripts/launch-readiness-audit.mjs
```

`PASS` means a static safeguard/file is present, **not** that a real transaction or production configuration is verified. `REVIEW` indicates a remaining business/operational gate; `BLOCKER` means a required static safeguard is missing. Do not enable production checkout based solely on this audit.

Current known status: isolated TEST checkout and paid webhook previously verified; TEST box-office pickup tools deployed; public seat checkout and holds intentionally disabled. Production launch requires independent inventory, approval, refund, security and operational verification.
