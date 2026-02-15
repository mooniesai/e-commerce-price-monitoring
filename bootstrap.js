// bootstrap.js
import { webcrypto } from "crypto";

// REQUIRED crypto polyfill for x402
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

// Load main API after polyfill
import("./api.js");
