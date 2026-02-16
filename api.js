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
  process.exit(1);
}

/**
 * x402 paywall middleware (Express)
 * (This sets up the payment-required + verification flow)
 */
app.use(
  paymentMiddleware({
    "POST /v1/price/check": {
      // Keep this minimal for now; you can add more networks/schemes later
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

app.post("/v1/price/check", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing url" });

    // ---- Playwright scrape (simple example) ----
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // TODO: replace selector with the real one for your target site(s)
    // Example fallback: return page title if no price selector yet
    const title = await page.title();

    await browser.close();

    return res.json({
      ok: true,
      url,
      title
      // price: "TODO"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
});

app.get("/", (req, res) => {
  res.send("Price Watcher API is running");
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
