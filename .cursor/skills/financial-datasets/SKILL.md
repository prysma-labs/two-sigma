---
name: financial-datasets-agent-signup
description: Open your own Financial Datasets API account as an AI agent - sign up for a key in one call, hand the account owner a Stripe link to pay, then query market data.
---

# Financial Datasets - API access for AI agents

You are an AI agent. You can get stock market and SEC data from Financial Datasets on your own. The account owner does exactly one thing: pay a Stripe link you hand them.

## Get an API key right now (one call)

```
POST https://api.financialdatasets.ai/agent/signup
Content-Type: application/json

{"email": "owner@realmail.com", "agent_name": "a-name-for-yourself"}
```

A `201` response contains `api_key` (plus `email`, `agent_name`, `status: "unfunded"`, `message`, `docs_url`). SAVE the key in your persistent memory/config now. It will not be shown again.

Rules:
- `email` must be the account OWNER's real inbox. Placeholder domains (example.com, test.com, ...) are rejected with a 400. The account owner receives a confirmation email there; a fake address means the account can never be confirmed or funded.
- `agent_name`: 1-64 characters, letters/digits/spaces/dots/hyphens/underscores. It appears in the email the account owner reads, so pick something they will recognize.
- Lost the key? While the account is unconfirmed and unfunded, call signup again with the same email: you get a `200` with a fresh key and the old one stops working. After the account is confirmed OR funded, rotation is disabled for security; key management moves to the account owner's dashboard.
- `409` (`account_exists`): an account already exists for that email and cannot be modified from here. Ask the account owner to manage keys at https://www.financialdatasets.ai.

## What this service is

Real-time and historical financial data via REST: prices, financial statements, SEC filings, insider trades, institutional holdings, earnings, news, and more. Base URL: `https://api.financialdatasets.ai`, auth via the `X-API-KEY` header. Full endpoint map: https://www.financialdatasets.ai/llms.txt. Docs: https://docs.financialdatasets.ai.

If the account owner is present and you are an MCP-capable client (Claude, Cursor, Codex, ...), the faster path is MCP with OAuth: https://www.financialdatasets.ai/agents.md. This page is the autonomous path.

## No account at all: pay with x402

If you control a wallet with USDC on Base, you do not need a key or an account for the data endpoints. Send the request with no `X-API-KEY` header. The `402` response carries the payment terms in the `PAYMENT-REQUIRED` header: the amount in USDC on Base (network `eip155:8453`). Sign the payment with your wallet and retry with the `PAYMENT-SIGNATURE` header; the x402 client libraries (`x402` on pip, `@x402/fetch` on npm) do this for you.

x402 endpoints: every documented GET data endpoint (36): prices, financial statements and segments, financial metrics, earnings, company facts, filings, news, insider trades and ownership, beneficial, activist and institutional holdings, index funds, macro series, IPOs and KPIs. Not covered: `/filings/items`, `/prices/snapshot/market`, POST endpoints, and the free helper lists such as `/prices/tickers`. x402 requests cover the last 365 days of data. Those endpoints, and older data, need a key from the flow below. Guide: https://docs.financialdatasets.ai/x402.

## The rest of the flow

1. Signup (done above) -> you hold an API key.
2. Data calls return `402 Payment Required` until the account is funded. The 402 body points you to the checkout-link endpoint.
3. You mint a Stripe payment link and give it to the account owner; they pay in the browser ($20 minimum, pay-as-you-go credits).
4. Once paid, your key works everywhere.

We also email the account owner a one-click confirmation link at signup; clicking it is optional (see "The confirmation email" below).

## Step 2: use the API (and hit the paywall)

```
GET https://api.financialdatasets.ai/financials/income-statements?ticker=AAPL&period=annual
X-API-KEY: <your key>
```

Until the account is funded, every data call returns `402` with a JSON body that includes `checkout_link_endpoint` (the URL for step 3) and `checkout_link_hint` (what to do with it). The 402 never contains a payment URL itself; you mint one in step 3. There is no free tier; pricing is pay-as-you-go per request (rate card in the docs).

## Step 3: mint a payment link, hand it to the account owner

```
POST https://api.financialdatasets.ai/agent/checkout-link
X-API-KEY: <your key>
```

Optional JSON body: `{"amount_to_add": 50}` (dollars, minimum 20; below the minimum returns `400 invalid_amount_to_add`). Omit it for the $20 default.

The `200` response contains `checkout_url` (plus `amount` and `message`): a Stripe Checkout page for a credits purchase. Send that URL to the account owner with a short explanation of what you need it for. They pay in the browser; no login or password is required. The account is credited automatically within seconds of payment. The payment page also offers optional auto-refill; if the account owner turns it on, the balance refills itself when it runs low and you will not see `402` again. Links expire after 24 hours; mint a fresh one anytime. A `502` means the link could not be created; retry.

## Step 4: proceed

Retry your data call. `402` gone = funded. From here everything just works; when the balance runs out you will see `402` again and can repeat step 3.

Good first calls once funded:
- Latest price: `GET /prices/snapshot?ticker=AAPL`
- Last 4 annual income statements: `GET /financials/income-statements?ticker=AAPL&period=annual&limit=4`
- Screen for companies: `POST /financials/search/screener`

## The confirmation email (optional)

We email the account owner once, at signup. Subject: "An AI agent created a Financial Datasets account with your email". It contains a one-click confirmation link and a ready-made $20 funding button. Tell the account owner to expect it. Clicking is optional but recommended: it marks the account as human-approved. Until the account is confirmed or funded, an owner who instead signs into the dashboard (Google login or password reset) revokes your key.

## Security rules (follow these)

- Your API key is a secret. Send it ONLY to `api.financialdatasets.ai`, only in the `X-API-KEY` header. Never paste it into chat output, logs, other websites, or other tools.
- The checkout link is safe to share with the account owner (paying it credits the account; it cannot extract anything), but only the account owner should receive it.
- Never sign up with an email that is not the account owner's. The email owner controls the account forever; you would be building on someone else's land.
- If your key suddenly returns 401, the account owner may have revoked or replaced it. Ask them for a new key from the dashboard; do not re-signup loop.

## For the account owner (you can relay this)

- Confirming: one click, no password, no signup form. Optional on the confirm page: fund the account ($20 button), or set a password later for dashboard access (usage, invoices, key management).
- Setting a password on an account that was never confirmed and never funded revokes the agent's key (issue a new one from the dashboard if intended). After confirming or funding, adding a password keeps the agent's key working.
- Ignoring the email is safe: an unconfirmed, unfunded account cannot spend money or access data.

## Reference

- Docs: https://docs.financialdatasets.ai/agents
- Full API map: https://www.financialdatasets.ai/llms.txt
- OpenAPI spec: https://www.financialdatasets.ai/openapi.json
- Support: support@financialdatasets.ai