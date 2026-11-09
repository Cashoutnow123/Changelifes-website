# ChangeLifes.org — pre-hosting build

This is a local Node.js 20+ starter based on the existing ChangeLifes.org site. It has **no public fundraising applications, accounts, or refund forms**. Only the owner creates campaigns. Public visitors can view published campaigns, donate using Stripe Checkout once configured, or email contactus@changelifes.org.

## Run locally

1. Install Node.js 20 or later.
2. Set `ADMIN_PASSWORD` to a strong unique password and `SESSION_SECRET` to a random string of at least 32 characters. Set `PUBLIC_BASE_URL=http://localhost:3000` and optionally `DATA_DIR` to a persistent private directory.
3. Run `node server.js` and open `http://localhost:3000`.
4. Click **Private Admin**, log in, and create your own campaign. No database or Stripe key is needed to test campaign management.
5. To test Stripe Checkout, set `STRIPE_SECRET_KEY` privately to your Stripe **test secret key**. For webhook-driven donation totals, use the Stripe CLI to forward test events to `http://localhost:3000/api/stripe/webhook`, and set `STRIPE_WEBHOOK_SECRET` to the CLI-provided signing secret. Use test card numbers from Stripe documentation. Do not share secret keys in chat.

**The publishable key provided in chat is not sufficient to start Checkout**. This server uses Stripe-hosted Checkout created by the server's secret key, so it does not need a publishable key in frontend JavaScript.

## Before live launch

Requires public HTTPS hosting, persistent private disk for `data/`, backups, `PUBLIC_BASE_URL=https://changelifes.org`, live Stripe keys configured privately, a webhook endpoint registered with Stripe, and complete end-to-end tests. For a real-money deployment, harden authentication, CSRF protections, secure cookies behind proxies, webhook idempotency/serialization, refund/dispute reconciliation, error monitoring, and payment reporting. Local JSON is not appropriate on an ephemeral serverless host or multiple instances without shared transactional storage.

The site does not collect visitor form submissions or store card data. Stripe necessarily collects and retains transaction data; the server retains campaign records and minimal payment identifiers/amounts to calculate totals. The owner manually distributes funds as described on the site; the website does not automate payouts.

## Automated checks

Run `node --test tests/*.test.js`. These tests use a temporary isolated data directory and do not contact Stripe.
