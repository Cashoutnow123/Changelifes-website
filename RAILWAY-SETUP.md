# Railway deployment checklist

Upload the CONTENTS of this folder into the root of your private GitHub repository (not the ZIP file and not an extra enclosing folder). Keep `public/index.html` and `tests/app.test.js` in their folders.

Railway service source: GitHub repository. Node 20+; start command `npm start` (or auto-detect).

Before deploying set Railway service Variables: `ADMIN_PASSWORD` (unique strong password), `SESSION_SECRET` (random 32+ character string), `PUBLIC_BASE_URL` (your HTTPS Railway-generated URL initially; later `https://changelifes.org`), `NODE_ENV=production`, `DATA_DIR=/data`. Never commit secret values to GitHub.

Attach a Railway persistent volume mounted at `/data` before creating fundraisers or processing payments. Back up JSON data regularly. Only use one app instance.

For Stripe test mode: add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` privately in Railway Variables, register `https://YOUR-DOMAIN/api/stripe/webhook` in Stripe, subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`, then test end to end. Do not activate live charges until security and payment/refund reconciliation are verified.

Warning: this is a starter, not an audited production payments platform. Review security, webhook processing, refunds/disputes, backups, and policies before live launch.
