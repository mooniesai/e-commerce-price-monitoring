import express from "express";
import cors from "cors";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// x402 paywall middleware (mainnet facilitator)
app.use(
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "POST /v1/price/check": {
        price: "$0.02",
        network: "base",
        config: {
          description: "Checks a product page URL and returns the current price + optional threshold status.",
          mimeType: "application/json",
        },
      },
    },
    facilitator
  )
);

// ✅ Your endpoint (put your Playwright price fetch logic inside here)
app.post("/v1/price/check", async (req, res) => {
  try {
    const { url, threshold } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing required field: url" });

    // TODO: your price extraction logic here
    // const price = await fetchPrice(url);

    return res.json({
      url,
      price: null,
      currency: "USD",
      threshold: threshold ?? null,
      status: null,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to fetch price" });
  }
});

app.get("/", (req, res) => {
  res.send("Price Watcher API is running. Use POST /v1/price/check");
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
