import express from "express";
import cors from "cors";
import { chromium } from "playwright";

import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAY_TO = process.env.WALLET_ADDRESS;

if (!PAY_TO) {
  console.error("Missing WALLET_ADDRESS env var");
  process.exit(1);
}

// ✅ Free endpoints first (no payment)
app.get("/", (req, res) => res.send("Price Watcher API is running ✅"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ✅ x402 payment middleware (Coinbase docs pattern)
const payment = paymentMiddleware(
  PAY_TO,
  {
    "POST /v1/price/check": {
      price: "0.02",          // USDC amount
      network: "base",
      config: {
        description: "Fetch page title (and later price) for a product URL",
        inputSchema: {
          bodyType: "json",
          bodyFields: {
            url: { type: "string", description: "Product page URL to fetch" }
          }
        },
        outputSchema: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            url: { type: "string" },
            title: { type: "string" }
          }
        }
      }
    }
  },
  facilitator // uses CDP_API_KEY_ID + CDP_API_KEY_SECRET from env
);

// ✅ Protected endpoint: payment required
app.post("/v1/price/check", payment, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const title = await page.title();

    await browser.close();

    return res.json({ ok: true, url, title });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
});

export default app;

