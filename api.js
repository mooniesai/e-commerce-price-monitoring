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

/* ===============================
   Free Endpoints
================================= */

app.get("/", (req, res) => {
  res.send("Price Watcher API is running ✅");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ===============================
   Playwright Runtime Check
================================= */

app.get("/playwright-check", async (req, res) => {
  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    await browser.close();

    return res.json({ ok: true, message: "Playwright launched successfully" });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      message: err?.message || "Playwright failed"
    });
  }
});

/* ===============================
   x402 Payment Middleware
================================= */

const payment = paymentMiddleware(
  PAY_TO,
  {
    "POST /v1/price/check": {
      price: "0.02",
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
  facilitator
);

/* ===============================
   Protected Endpoint
================================= */

app.post("/v1/price/check", payment, async (req, res) => {
  const startedAt = Date.now();
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing or invalid url"
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);

    page.on("console", (msg) =>
      console.log("[PAGE CONSOLE]", msg.text())
    );

    page.on("pageerror", (err) =>
      console.log("[PAGE ERROR]", err?.message)
    );

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded"
    });

    const status = response?.status?.() ?? null;
    const title = await page.title();

    const durationMs = Date.now() - startedAt;

    return res.status(200).json({
      ok: true,
      url,
      status,
      title,
      durationMs
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;

    return res.status(200).json({
      ok: false,
      url,
      error: "Scrape failed",
      reason: err?.name || "Error",
      message: err?.message || "Unknown error",
      durationMs
    });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
