import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { paymentMiddleware } from "@x402/express";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

if (!WALLET_ADDRESS) {
  console.error("Missing WALLET_ADDRESS env var");
}

/* -------------------------------------------------------
   HEALTH CHECK (no payment required)
-------------------------------------------------------- */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "API is healthy",
    walletConfigured: !!WALLET_ADDRESS
  });
});

/* -------------------------------------------------------
   PLAYWRIGHT CHECK (no payment required)
-------------------------------------------------------- */
app.get("/health/playwright", async (req, res) => {
  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const title = await page.title();
    await browser.close();

    res.json({
      ok: true,
      message: "Playwright working",
      title
    });
  } catch (err) {
    console.error("Playwright error:", err);
    res.status(500).json({
      ok: false,
      error: "Playwright failed",
      details: err.message
    });
  }
});

/* -------------------------------------------------------
   x402 PAYWALL
-------------------------------------------------------- */
if (WALLET_ADDRESS) {
  app.use(
    paymentMiddleware({
      "POST /v1/price/check": {
        accepts: [
          {
            network: "base",
            scheme: "exact",
            amount: "0.02",
            asset: "USDC",
            payTo: WALLET_ADDRESS
          }
        ],
        description: "Fetch the current price for a product URL"
      }
    })
  );
}

/* -------------------------------------------------------
   MAIN PRICE ENDPOINT
-------------------------------------------------------- */
app.post("/v1/price/check", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "Missing url"
      });
    }

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    const title = await page.title();

    await browser.close();

    res.json({
      ok: true,
      url,
      title
    });

  } catch (err) {
    console.error("Price check error:", err);

    res.status(500).json({
      ok: false,
      error: "Failed to fetch price",
      details: err.message
    });
  }
});

/* -------------------------------------------------------
   ROOT
-------------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("Price Watcher API running");
});

/* -------------------------------------------------------
   START SERVER
-------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

/* -------------------------------------------------------
   IMPORTANT: EXPORT DEFAULT (required by bootstrap.js)
-------------------------------------------------------- */
export default app;