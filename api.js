import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { paymentMiddleware } from "x402-express";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// ----------------------------
// Unprotected endpoints first
// ----------------------------
app.get("/", (req, res) => {
  res.status(200).send("Price Watcher API is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "price-watcher-x402",
    hasWallet: Boolean(WALLET_ADDRESS),
  });
});

/**
 * Proves Playwright + Chromium can launch on Railway.
 * This is the fastest way to debug “it paid but returned 500”.
 */
app.get("/playwright-check", async (req, res) => {
  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const title = await page.title();

    res.status(200).json({
      ok: true,
      chromium: "launched",
      title,
    });
  } catch (err) {
    console.error("playwright-check failed:", err);
    res.status(500).json({
      ok: false,
      error: "Playwright failed to launch or navigate",
      message: err?.message || String(err),
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// If WALLET_ADDRESS is missing, don’t crash the whole container.
// Just log it — reviewer can still hit /health and /playwright-check.
if (!WALLET_ADDRESS) {
  console.warn("WARNING: Missing WALLET_ADDRESS env var");
}

// ----------------------------
// x402 paywall middleware
// Protect ONLY the paid endpoint(s)
// ----------------------------
const network = "base"; // change to "base-sepolia" if you're testing on testnet
const facilitatorObj = { url: "https://x402.org/facilitator" }; // common facilitator URL

app.use(
  paymentMiddleware(
    WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
    {
      "POST /v1/price/check": {
        price: "$0.02",
        network,
        description: "Fetch the current page title (price extraction TBD)",
      },
    },
    facilitatorObj
  )
);

// ----------------------------
// Paid endpoint
// ----------------------------
app.post("/v1/price/check", async (req, res) => {
  const start = Date.now();
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Helps reduce bot blocks a tiny bit
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // For now we return title; price scraping is site-specific
    const title = await page.title();

    return res.status(200).json({
      ok: true,
      url,
      title,
      ms: Date.now() - start,
    });
  } catch (err) {
    console.error("price/check failed:", err);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch price",
      message: err?.message || String(err),
      hint:
        "Try GET /playwright-check first. If that fails, Playwright install/runtime is the issue. If it passes, the target site may be blocking scraping.",
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// IMPORTANT: export default for bootstrap.js
export default app;
