#!/usr/bin/env tsx
// Smoke-test UNISWAP_API_KEY by pulling a tiny USDC→WETH quote on Base.
// Exits 0 on success, prints the quote summary; non-zero on auth/shape errors.

import { config } from "node:process";

const apiKey = process.env.UNISWAP_API_KEY;
const baseUrl =
  process.env.UNISWAP_TRADING_API_URL ?? "https://trade-api.gateway.uniswap.org/v1";

if (!apiKey) {
  console.error("UNISWAP_API_KEY not set — copy .env.example to .env and fill it");
  process.exit(1);
}

// Base mainnet, chainId 8453
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";

const body = {
  type: "EXACT_INPUT",
  tokenInChainId: 8453,
  tokenOutChainId: 8453,
  tokenIn: USDC,
  tokenOut: WETH,
  amount: "1000000", // 1 USDC (6 decimals)
  swapper: "0x0000000000000000000000000000000000000001",
  protocols: ["V3", "V4"],
  routingPreference: "BEST_PRICE",
};

const res = await fetch(`${baseUrl}/quote`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`quote failed: ${res.status} ${res.statusText}`);
  console.error(text);
  process.exit(1);
}

let parsed: any;
try {
  parsed = JSON.parse(text);
} catch {
  console.error("quote returned non-JSON body:");
  console.error(text);
  process.exit(1);
}

const quote = parsed?.quote ?? parsed;
const out = quote?.output?.amount ?? quote?.outputAmount ?? quote?.output;
console.log("uniswap quote OK");
console.log(`  request:  1 USDC → WETH on Base`);
console.log(`  output:   ${out ?? "<unknown — full body below>"}`);
if (!out) console.log(JSON.stringify(parsed, null, 2));
