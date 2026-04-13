// test change

import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402";

const app = express();
app.use(cors());
app.use(express.json());

const playwright = addExtra(chromium);
playwright.use(StealthPlugin());

const PORT = process.env.PORT || 3000;
const NETWORK = "eip155:8453"; // Base mainnet
const PAY_TO = process.env.WALLET_ADDRESS;

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.error("❌ Missing CDP API credentials in environment variables");
  process.exit(1);
}

if (!PAY_TO) {
  console.error("❌ Missing WALLET_ADDRESS env var");
  process.exit(1);
}

// x402 facilitator + resource server
const facilitatorClient = new HTTPFacilitatorClient(facilitator);
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmScheme()
);

// Health / info route
app.get("/", (req, res) => {
  res.send("Price Watcher API — POST /v1/price/check");
});

// Optional diagnostic route
app.get("/playwright-check", async (req, res) => {
  let browser;
  try {
    browser = await playwright.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH
        ? undefined
        : "/usr/bin/chromium"
    });

    const page = await browser.newPage();
    await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 20000
    });

    const title = await page.title();
    res.json({ ok: true, title });
  } catch (err) {
    console.error("❌ Playwright check failed:", err);
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  } finally {
    if (browser) await browser.close();
  }
});

// Paid x402 middleware on the real mainnet endpoint
app.use(
  paymentMiddleware(
    {
      "POST /v1/price/check": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.02",
            network: NETWORK,
            payTo: PAY_TO
          }
        ],
        description: "Fetch current product price from a given e-commerce URL",
        mimeType: "application/json"
      }
    },
    resourceServer
  )
);

// Main paid endpoint
app.post("/v1/price/check", async (req, res) => {
  try {
    const { url, threshold } = req.body || {};

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "Missing required field: url"
      });
    }

    const result = await scrapePrice(url);

    const priceNumber =
      typeof result.price === "number" && Number.isFinite(result.price)
        ? result.price
        : null;

    const thresholdNumber =
      threshold !== undefined && threshold !== null && threshold !== ""
        ? Number(threshold)
        : null;

    const belowThreshold =
      priceNumber !== null &&
      thresholdNumber !== null &&
      Number.isFinite(thresholdNumber)
        ? priceNumber <= thresholdNumber
        : null;

    return res.status(200).json({
      ok: true,
      url,
      title: result.title,
      price: priceNumber,
      currency: result.currency,
      threshold: thresholdNumber,
      belowThreshold
    });
  } catch (err) {
    console.error("❌ Price check failed:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

async function scrapePrice(url) {
  let browser;

  try {
    browser = await playwright.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH
        ? undefined
        : "/usr/bin/chromium"
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const title = await page.title();

    // Try common price selectors first
    const possibleSelectors = [
      '[itemprop="price"]',
      '[data-testid*="price"]',
      '[class*="price"]',
      '[id*="price"]',
      'meta[property="product:price:amount"]',
      'meta[name="twitter:data1"]'
    ];

    let priceText = null;

    for (const selector of possibleSelectors) {
      try {
        const el = page.locator(selector).first();
        const count = await el.count();
        if (count > 0) {
          const tagName = await el.evaluate((node) => node.tagName.toLowerCase());

          if (tagName === "meta") {
            priceText = await el.getAttribute("content");
          } else {
            priceText = await el.textContent();
          }

          if (priceText && priceText.trim()) break;
        }
      } catch {
        // keep going
      }
    }

    // Fallback: scan page text
    if (!priceText) {
      const bodyText = await page.locator("body").innerText();
      priceText = bodyText;
    }

    const parsed = extractPrice(priceText);

    return {
      title,
      price: parsed.price,
      currency: parsed.currency
    };
  } finally {
    if (browser) await browser.close();
  }
}

function extractPrice(text) {
  if (!text || typeof text !== "string") {
    return { price: null, currency: "USD" };
  }

  // Common price patterns
  const patterns = [
    { regex: /\$[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/, currency: "USD" },
    { regex: /USD[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i, currency: "USD" },
    { regex: /€[\s]*([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{2})?)/, currency: "EUR" },
    { regex: /£[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/, currency: "GBP" }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match && match[1]) {
      let raw = match[1];

      if (pattern.currency === "EUR") {
        raw = raw.replace(/\./g, "").replace(",", ".");
      } else {
        raw = raw.replace(/,/g, "");
      }

      const price = Number(raw);
      if (Number.isFinite(price)) {
        return {
          price,
          currency: pattern.currency
        };
      }
    }
  }

  return { price: null, currency: "USD" };
}

app.listen(PORT, () => {
  console.log(`✅ Price Watcher API running on port ${PORT}`);
  console.log(`🌐 Network: ${NETWORK}`);
  console.log(`💸 Price: $0.02`);
  console.log(`👛 Pay-to wallet: ${PAY_TO}`);
});

export default app;
