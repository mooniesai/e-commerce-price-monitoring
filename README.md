# Price Watcher API 💸🛍️

**Real-time product price lookup for AI agents and automated shopping workflows.**

Give Price Watcher a public e-commerce product URL → get its current price → optionally compare it with a target price → pay **$0.02 per call via x402 on Base**.

No API subscription. No monthly plan. Machine-to-machine payment per request.

---

## What it does

Price Watcher lets agents and applications check the current price of a product from a public e-commerce URL.

Use it for:

- Product price checks
- Price monitoring workflows
- Target-price tracking
- Shopping agents
- Deal-finding agents
- E-commerce research
- Retail automation
- Wishlist monitoring workflows

---

## Endpoint

### `POST /v1/price/check`

**Production URL**

```text
https://e-commerce-price-monitoring-production.up.railway.app/v1/price/check
Price

$0.02 USDC per request

Network

Base

Payment protocol

x402 v2
Request

Send a public product URL.

You can optionally include a threshold to determine whether the current product price is at or below your target.

{
  "url": "https://www.example.com/product/example-product",
  "threshold": 50
}
Parameters
Field	Required	Type	Description
url	Yes	string	Public e-commerce product page URL
threshold	No	number	Optional target price for comparison
Pay + call with Awal

Price Watcher can be called using an x402-compatible client such as Awal.

npx awal@latest x402 pay \
  https://e-commerce-price-monitoring-production.up.railway.app/v1/price/check \
  -X POST \
  -d '{"url":"https://www.example.com/product/example-product","threshold":50}' \
  --max-amount 50000 \
  --json

The client receives the x402 payment requirement, pays the request in USDC on Base, and submits the paid API call.

Without payment

Calling the paid endpoint without an x402 payment returns:

HTTP 402 Payment Required

This allows x402-compatible agents to discover the payment requirement and complete payment automatically.

Example result

A successful price check can return product information such as:

{
  "ok": true,
  "url": "https://www.example.com/product/example-product",
  "title": "Example Product",
  "price": 42,
  "currency": "USD",
  "threshold": 50,
  "belowThreshold": true
}

Actual results depend on the public product page being inspected.

Agent discovery 🤖

Price Watcher publishes machine-readable discovery metadata so AI agents can understand:

What the API does
How to call it
What inputs it accepts
What the request costs
Which x402 network it uses
OpenAPI
https://e-commerce-price-monitoring-production.up.railway.app/openapi.json
Coinbase x402 Bazaar

Price Watcher is discoverable through the x402 Bazaar ecosystem.

Example searches:

npx awal@latest x402 bazaar search "product price"
npx awal@latest x402 bazaar search "price monitoring"
x402scan

Price Watcher is also registered on x402scan as a paid API resource.

Why Price Watcher?

Most price-data services require API keys, subscriptions, accounts, or monthly commitments.

Price Watcher is designed for agentic commerce:

An agent needs a product price.
It discovers Price Watcher.
It sees the $0.02 price.
It pays via x402.
It receives the result.

One request. One payment. No subscription relationship required.

Built with
Node.js
Express
Playwright
x402
Coinbase Developer Platform
Base
Railway
Status

🟢 Live

Production endpoint:

https://e-commerce-price-monitoring-production.up.railway.app/v1/price/check

Price:

$0.02 USDC / call
