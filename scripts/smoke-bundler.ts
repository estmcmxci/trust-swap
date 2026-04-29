#!/usr/bin/env tsx
// Smoke-test BUNDLER_URL_BASE with eth_supportedEntryPoints.
// Exits 0 if at least one entry point is returned; non-zero otherwise.

const url = process.env.BUNDLER_URL_BASE;
if (!url) {
  console.error("BUNDLER_URL_BASE not set — copy .env.example to .env and fill it");
  process.exit(1);
}

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_supportedEntryPoints",
    params: [],
  }),
});

const json: any = await res.json().catch(() => null);
if (!res.ok || !json) {
  console.error(`bundler request failed: ${res.status} ${res.statusText}`);
  console.error(await res.text().catch(() => "<unreadable>"));
  process.exit(1);
}

if (json.error) {
  console.error("bundler returned JSON-RPC error:", json.error);
  process.exit(1);
}

const eps = json.result;
if (!Array.isArray(eps) || eps.length === 0) {
  console.error("bundler returned no entry points:", json);
  process.exit(1);
}

console.log("bundler OK");
console.log(`  url:          ${url.replace(/\/[^/]+$/, "/<redacted>")}`);
console.log(`  entryPoints:  ${eps.join(", ")}`);
