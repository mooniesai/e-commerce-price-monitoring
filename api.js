import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// Stealth mode so fashion sites don't block us
const chromiumExtra = addExtra(chromium);
chromiumExtra.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PAY_TO = process.env.WALLET_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const NETWORK = process.env.X402_NETWORK || "eip155:8453";

if (!PAY_TO) {
  console.error("❌ Missing WALLET_ADDRESS env var");
  process.exit(1);
}

// ── Free tier usage tracker (in-memory, resets on restart) ──
// Key: IP address  Value: number of free checks used
const freeUsage = new Map();
const FREE_LIMIT = 4;

function getRealIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// ── x402 setup ──
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// ── x402 paywall — only hits if free tier is exhausted ──
app.use(
  paymentMiddleware(
    {
      "POST /v1/price/check": {
        accepts: {
          scheme: "exact",
          price: "$0.02",
          network: NETWORK,
          payTo: PAY_TO,
        },
        description: "Fetch current price for a product URL",
        mimeType: "application/json",
      },
    },
    resourceServer
  )
);

// ── Price extractor helper ──
async function scrapePrice(url) {
  const browser = await chromiumExtra.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();

  // Look human
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

  const title = await page.title();

  // Try multiple common price selectors across fashion/retail sites
  const price = await page.evaluate(() => {
    const selectors = [
      '[class*="price"]',
      '[id*="price"]',
      '[data-price]',
      '[class*="Price"]',
      '[itemprop="price"]',
      '.product-price',
      '.sale-price',
      '#priceblock_ourprice',    // Amazon
      '.a-price-whole',          // Amazon
      '[class*="product__price"]', // Shopify
      '[class*="pdp-price"]',    // ASOS, fashion sites
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return null;
  });

  await browser.close();
  return { title, price };
}

// ── Routes ──

// Health check
app.get("/", (req, res) => res.send("Price Watcher API is running ✅"));

// Free tier status check — so clients know how many free checks remain
app.get("/v1/usage", (req, res) => {
  const ip = getRealIp(req);
  const used = freeUsage.get(ip) || 0;
  const remaining = Math.max(0, FREE_LIMIT - used);
  res.json({ ip, used, remaining, freeLimit: FREE_LIMIT });
});

// Playwright diagnostic
app.get("/playwright-check", async (req, res) => {
  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 45000 });
    const title = await page.title();
    await browser.close();
    res.json({ ok: true, title });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Main paid/free endpoint
app.post("/v1/price/check", async (req, res) => {
  const ip = getRealIp(req);
  const used = freeUsage.get(ip) || 0;
  const isFree = used < FREE_LIMIT;

  try {
    const { url, threshold } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    // If still in free tier, serve without payment and increment counter
    if (isFree) {
      freeUsage.set(ip, used + 1);
      const { title, price } = await scrapePrice(url);
      return res.json({
        ok: true,
        free: true,
        checksRemaining: FREE_LIMIT - (used + 1),
        url,
        title,
        price,
        threshold: threshold ?? null,
      });
    }

    // Paid tier — x402 middleware already verified payment above
    const { title, price } = await scrapePrice(url);
    return res.json({
      ok: true,
      free: false,
      url,
      title,
      price,
      threshold: threshold ?? null,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

export default app;
