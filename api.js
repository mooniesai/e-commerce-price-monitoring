import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402";

import {
  declareDiscoveryExtension,
  bazaarResourceServerExtension
} from "@x402/extensions/bazaar";

const app = express();

// Railway sits in front of the app as a reverse proxy.
// Trust the forwarded protocol so x402/Bazaar generates
// https:// resource URLs instead of internal http:// URLs.
app.set("trust proxy", 1);

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

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(
    NETWORK,
    new ExactEvmScheme()
  )
  .registerExtension(bazaarResourceServerExtension);

// Health / info route
app.get("/", (req, res) => {
  res.send("Price Watcher API — POST /v1/price/check");
});
app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.1.0",

    info: {
      title: "Price Watcher API",
      version: "1.0.0",
      description:
        "Machine-payable e-commerce price checking API powered by x402.",

      "x-guidance":
        "Use POST /v1/price/check when you need the current price of a product from a public e-commerce product URL. Provide the product URL and optionally a target threshold. The request costs $0.02 via x402 on Base.",

      contact: {
        email: "bernettamoore2@gmail.com"
      }
    },

    servers: [
      {
        url: "https://e-commerce-price-monitoring-production.up.railway.app"
      }
    ],

    paths: {
      "/v1/price/check": {
        post: {
          operationId: "checkProductPrice",

          summary: "Check the current price of an e-commerce product",

          description:
            "Fetch the current product price from a public e-commerce product URL and optionally compare it with a target price.",

          tags: ["E-commerce", "Price Monitoring"],

          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: "0.020000"
            },

            protocols: [
              {
                x402: {}
              }
            ]
          },

          requestBody: {
            required: true,

            content: {
              "application/json": {
                schema: {
                  type: "object",

                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      description:
                        "Public e-commerce product page URL to check."
                    },

                    threshold: {
                      type: "number",
                      description:
                        "Optional target price used to determine whether the current price is at or below the desired amount."
                    }
                  },

                  required: ["url"]
                },

                example: {
                  url: "https://www.sephora.com/product/example-product",
                  threshold: 20
                }
              }
            }
          },

          responses: {
            "200": {
              description: "Successful price check",

              content: {
                "application/json": {
                  schema: {
                    type: "object",

                    properties: {
                      ok: {
                        type: "boolean"
                      },

                      url: {
                        type: "string"
                      },

                      title: {
                        type: ["string", "null"]
                      },

                      price: {
                        type: ["number", "null"]
                      },

                      currency: {
                        type: ["string", "null"]
                      },

                      threshold: {
                        type: ["number", "null"]
                      },

                      belowThreshold: {
                        type: ["boolean", "null"]
                      }
                    },

                    required: ["ok", "url"]
                  }
                }
              }
            },

            "400": {
              description: "Invalid request"
            },

            "402": {
              description: "Payment Required"
            },

            "500": {
              description: "Price check failed"
            }
          }
        }
      }
    }
  });
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

    res.json({
      ok: true,
      title
    });
  } catch (err) {
    console.error("❌ Playwright check failed:", err);

    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  } finally {
    if (browser) {
      await browser.close();
    }
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

        description:
          "Fetch the current product price from a public e-commerce product URL and optionally compare it with a target price.",

        mimeType: "application/json",

        extensions: {
          ...declareDiscoveryExtension({
            bodyType: "json",

            input: {
              url: "https://www.sephora.com/product/example-product",
              threshold: 20
            },

            inputSchema: {
              properties: {
                url: {
                  type: "string",
                  format: "uri",
                  description:
                    "Public e-commerce product page URL to inspect."
                },

                threshold: {
                  type: "number",
                  description:
                    "Optional target price. If provided, the response indicates whether the current product price is at or below this amount."
                }
              },

              required: ["url"]
            },

            output: {
              example: {
                ok: true,
                url: "https://www.sephora.com/product/example-product",
                title: "Example Product",
                price: 18,
                currency: "USD",
                threshold: 20,
                belowThreshold: true
              }
            }
          })
        }
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
      threshold !== undefined &&
      threshold !== null &&
      threshold !== ""
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
          const tagName = await el.evaluate((node) =>
            node.tagName.toLowerCase()
          );

          if (tagName === "meta") {
            priceText = await el.getAttribute("content");
          } else {
            priceText = await el.textContent();
          }

          if (priceText && priceText.trim()) {
            break;
          }
        }
      } catch {
        // Continue to the next selector.
      }
    }

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
    if (browser) {
      await browser.close();
    }
  }
}

function extractPrice(text) {
  if (!text || typeof text !== "string") {
    return {
      price: null,
      currency: "USD"
    };
  }

  const patterns = [
    {
      regex: /\$[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/,
      currency: "USD"
    },
    {
      regex: /USD[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
      currency: "USD"
    },
    {
      regex: /€[\s]*([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{2})?)/,
      currency: "EUR"
    },
    {
      regex: /£[\s]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/,
      currency: "GBP"
    }
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

  return {
    price: null,
    currency: "USD"
  };
}

export default app;
