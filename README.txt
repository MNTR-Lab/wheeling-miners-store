WHEELING MINERS — CONTROLLED TEST CHECKOUT CONSOLE

Copy controlled-checkout-console.html into the repository ROOT and commit.
No Worker routing or database migration required; Wrangler assets publish the page.
Deploy TEST only:
cd ~/Downloads/wheeling-miners-latest && git pull origin main && npx wrangler deploy --config wrangler.test.jsonc

Open https://wheeling-miners-store-test.bikard.workers.dev/controlled-checkout-console.html

This is a staff-only UI to EXISTING authenticated admin endpoints. The HTML is publicly retrievable but the APIs require the TEST seat admin token. It cannot enable production sales.
No further $1 test purchase is requested. The previously SOLD seat is explicitly blocked in the UI.
