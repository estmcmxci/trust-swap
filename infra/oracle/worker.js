// Phase 0 placeholder — claims the trust-swap-oracle Cloudflare Worker name.
// Real handler (POST /attest) lands in packages/oracle/ during Phase 1+2.

export default {
  async fetch() {
    return new Response(
      "trust-swap-oracle placeholder — Phase 2 fills in the real handler",
      { headers: { "content-type": "text/plain" } },
    );
  },
};
