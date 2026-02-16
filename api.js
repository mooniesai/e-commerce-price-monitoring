import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { createX402ExpressMiddleware } from "@x402/express";

const app = express();

app.use(cors());
app.use(express.json());

/**
 * x402 middleware
 * This verifies payment before your route executes.
 */
app.use(
  createX402ExpressMiddleware({
    network: "base",
    walletAddress: process.env.WALLET_ADDRESS,
    price: {
      amount: "0.02",
      currency: "USDC"
    }
  })
);

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Price Watcher API is live.");
});

/**
 * Main endpoint
 */
app.post("/v1/price/check", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "Missing product URL" });
    }

    // Launch browser
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Basic price detection logic (can improve later)
    const price = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/\$\d+(?:\.\d{2})?/);
      return match ? match[0] : null;
    });

    await browser.close();

    if (!price) {
      return res.status(404).json({ error: "Price not found" });
    }

    res.json({
      success: true,
      price
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

export default app;
