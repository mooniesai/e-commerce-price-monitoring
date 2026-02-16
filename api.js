// api.js
import { config } from "dotenv";
import express from "express";
import cors from "cors";

// x402 imports (use server paths exactly)
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402";

import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

// Scraper
import { chromium } from "playwright";

config();

// -------------------- CONFIG --------------------
const API_NAME = "Price Watcher API";
const PRICE_USD = "0.02";                 // $0.02 per request
const NETWORK = "eip155:8453";            // Base mainnet
const PORT = Number(process.env.PORT || 3000);
const payTo = process.env.WALLET_ADDRESS;

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !payTo) {
  console.error("Missing env vars: CDP_API_KEY_ID, CDP_API_KEY_SECRET, WALLET_ADDRESS");
  process.exit(1);
}

// -------------------- x402 SETUP --------------------
const facilitatorClient = new HTTPFacilitatorClient(facilitator);
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmSchema()
);

// paywall config (for wallet UI flows; keep aligned with docs)
const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({ appName: API_NAME, testnet: false })
  .build();

// -------------------- APP --------------------
const app = express();
app.use(cors());
app.use(express.json());

// -------------------- SIMPLE CACHE (MVP) --------------------
const cache = new Map(); // key -> { value, expiresAt }
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function setCache(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// -------------------- x402 PAYMENT MIDDLEWARE --------------------
// CRITICAL: wildcard route pattern, not :params (docs)
app.use(
  paymentMiddleware(
    {
      "POST /v1/price/*": {
        accepts: [{ scheme: "exact", price: PRICE_USD, network: NETWORK, payTo }],
        description: "Fetch current product price from a URL (optional selector & threshold).",
        mimeType: "application/json"
      }
    },
    resourceServer,
    undefined,
    paywall // CRITICAL: must be 4th arg
  )
);

// -------------------- FREE ROUTES --------------------
app.get("/", (req, res) => res.send(`${API_NAME} — POST /v1/price/check`));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// -------------------- PAID ROUTE --------------------
// Note: route path must match wildcard used above: /v1/price/*
app.post("/v1/price/check", async (req, res) => {
  const { url, selector, below } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing required field: url (string)" });
  }

  // MVP safety: selector optional, but strongly recommended
  // If selector omitted, we do a basic heuristic (best effort), but call that out clearly.
  const cacheKey = JSON.stringify({ url, selector: selector || null, below: below ?? null });
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await fetchPrice({ url, selector });

    const threshold = typeof below === "number" ? below : (typeof below === "string" ? Number(below) : null);
    const belowThreshold =
      threshold != null && Number.isFinite(threshold) ? (result.price != null ? result.price <= threshold : null) : null;

    const payload = {
      url,
      price: result.price,
      currency: result.currency || "UNKNOWN",
      belowThreshold,
      extraction: {
        usedSelector: result.usedSelector,
        confidence: result.confidence
      },
      fetchedAt: new Date().toISOString()
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({
      error: "Failed to fetch price",
      message: e?.message || String(e)
    });
  }
});

async function fetchPrice({ url, selector }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  });

  // Timeouts keep it calm and predictable
  page.setDefaultTimeout(20000);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // If selector provided, use it (best MVP path)
    if (selector && typeof selector === "string") {
      const text = await page.locator(selector).first().innerText();
      const parsed = parsePrice(text);
      return {
        price: parsed.price,
        currency: parsed.currency,
        usedSelector: selector,
        confidence: parsed.price != null ? "high" : "low"
      };
    }

    // Fallback heuristic: grab visible text and try to find a price-like pattern
    const bodyText = await page.locator("body").innerText();
    const parsed = parsePrice(bodyText);
    return {
      price: parsed.price,
      currency: parsed.currency,
      usedSelector: null,
      confidence: parsed.price != null ? "low" : "none"
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function parsePrice(text) {
  if (!text) return { price: null, currency: null };

  // Very simple parsing: looks for $123.45 or €123,45 etc.
  // MVP: keep it basic and transparent.
  const patterns = [
    { currency: "USD", re: /\$(\s?)(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/ },
    { currency: "EUR", re: /€(\s?)(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?)/ },
    { currency: "GBP", re: /£(\s?)(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/ }
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m?.[2]) {
      const raw = m[2].replace(/\s/g, "").replace(/,/g, "");
      // Handle EUR decimal comma
      const normalized = p.currency === "EUR" ? raw.replace(/\./g, "").replace(",", ".") : raw;
      const price = Number(normalized);
      if (Number.isFinite(price)) return { price, currency: p.currency };
    }
  }

  return { price: null, currency: null };
}

// -------------------- START --------------------
app.listen(PORT, () => {
  console.log(`✅ ${API_NAME} running on port ${PORT}`);
  console.log(`💸 Price: $${PRICE_USD} per request`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`👛 Wallet: ${payTo}`);
});
