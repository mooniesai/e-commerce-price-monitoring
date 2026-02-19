import express from "express";
import cors from "cors";
import { chromium } from "playwright";

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Wallet that receives funds
const PAY_TO = process.env.WALLET_ADDRESS;

// Facilitator (testnet default)
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://x402.org/facilitator";

// Network (Base Sepolia default)
const NETWORK = process.env.X402_NETWORK || "eip155:84532";

if (!PAY_TO) {
  console.error("Missing WALLET_ADDRESS env var");
  process.exit(1);
}

// --- x402 setup (official pattern) ---
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

const server = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmScheme()
);

// Paywall the price-check endpoint
app.use(
  paymentMiddleware(
    {
      "POST /v1/price/check": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.02", // USDC in dollars
            network: NETWORK,
            payTo: PAY_TO,
          },
        ],
        description: "Fetch the current price/title for a product URL",
        mimeType: "application/json",
      },
    },
    server
  )
);

// Health check
app.get("/", (req, res) => {
  res.send("Price Watcher API is running");
});

// Playwright check (diagnostic)
app.get("/playwright-check", async (req, res) => {
  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const title = await page.title();
    await browser.close();

    res.json({ ok: true, title });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Playwright failed to launch or navigate",
      message: err?.message || String(err),
    });
  }
});

// Paid endpoint
app.post("/v1/price/check", async (req, res) => {
  try {
    const { url, threshold } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const title = await page.title();

    await browser.close();

    return res.json({
      ok: true,
      url,
      title,
      threshold: threshold ?? null,
      // price: "TODO"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch price",
      message: err?.message || String(err),
    });
  }
});

// Export default for bootstrap.js to import
export default app;