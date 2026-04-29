# FEEDBACK.md — Building TrustSwap on the Uniswap Trading API

> Required for prize eligibility. This is what we wish we'd known on day one
> and what we want next, written from inside a real composition — not a
> hello-world swap. TrustSwap wraps the Universal Router with an off-chain
> attestation gate, so we hit the API hard from a non-standard angle.

**TL;DR** — the 3-step flow is the right shape. The biggest gap is that
**ENS as an identity primitive is invisible to the Trading API**, which
forces every consumer who cares about *who* they're swapping with to bolt
on resolution + attestation infrastructure outside the API. We built
exactly that infrastructure (an off-chain oracle that re-resolves through
ENS via the Trust Resolution Layer) and saw firsthand how much UX,
agent-readiness, and reputation-aware execution Uniswap leaves on the
table by treating addresses as opaque bytes.

We executed real swaps on Base mainnet during this build — so the
observations below are grounded in tx hashes, not theory. The first
end-to-end TrustSwap call: [`0x3744af39…3b33a2`](https://basescan.org/tx/0x3744af390baf136dbe2402978ecd448eba7dec2053fbe361ee1e2c428d3b33a2)
(0.0001 ETH → 0.227246 USDC, gated by an oracle attestation, signed by a
ZeroDev kernel session key, broadcast through Pimlico, wrapping Universal
Router via our `TrustSwapRouter` at
[`0x3AEF…0925`](https://basescan.org/address/0x3AEFfbAA88186E557eADdCf6bb57C536f3e40925)).

---

## What worked

- **The 3-step flow** (`/check_approval` → `/quote` → `/swap`) genuinely is
  the right shape. It composes naturally with a pre-flight policy layer
  because each call is a discrete decision point.
- **Trading-API-as-calldata-source** is the under-celebrated part of the
  product. We pass the API's `swap.data` straight into our own router via
  low-level `call`, and the value flows through cleanly. That means anyone
  with a Solidity wrapper contract can take Uniswap routing as a black-box
  and add their own gating, fee, settlement, or accounting logic on top
  without re-implementing routing. We call this the "wrapper-router pattern"
  in our spec — it's the entire foundation of TrustSwap and it just worked.
- **Routing-aware response shapes** (`routing: "CLASSIC" | "DUTCH_V2" | …`)
  are the right design — discriminated unions keyed on a single field make
  client-side branching natural.
- **`gasFeeUSD`** as a string in the response is great — saved us the
  embarrassing "ETH price hardcoded → estimate is $87" footgun.
- **Excellent agent-side documentation in `Uniswap/uniswap-ai`.** The
  `swap-integration` SKILL.md has more concrete edge cases than most
  paid-product docs — UniswapX's local-vs-server `permitData` semantics,
  L2 WETH unwrap nuance, wagmi v2 hook traps. This is rare and valuable.

## What didn't / friction we hit

### `routingPreference: "CLASSIC"` is deprecated, docs disagree

Our first smoke test on day 1 hit `400 RequestValidationError:
"routingPreference" must be one of [BEST_PRICE, FASTEST]`. The
`uniswap-ai` SKILL.md still listed `CLASSIC` as a valid option. We
discovered the change only by reading the actual error message and
querying the live API docs via context7. The docs site should be the
authoritative surface here.

### `tokenInChainId` / `tokenOutChainId` must be **strings**

The TypeScript example in some doc snippets shows them as numbers; the
gateway rejects numeric input on `/quote`. We had to learn this from the
422 response (which doesn't say "must be string", just "validation
error"). Unambiguous types in the OpenAPI spec would prevent this.

### The `/swap` body shape is the single biggest footgun

We hit three bugs in this area:

1. Wrapping the quote response in `{ quote: quoteResponse }` instead of
   spreading it. The API's error message — *"quote does not match any of
   the allowed types"* — points at the quote field, but the cause is
   *not* the quote: it's the *envelope*.
2. Including `permitData: null` instead of omitting the field entirely.
   Same generic error message.
3. Including `permitData` for UniswapX routes. UniswapX uses `permitData`
   only for *local* signing (the order is encoded in `quote.encodedOrder`);
   the `/swap` body must omit it. Same generic error message.

A `quote_id` field returned from `/quote` and accepted as the only
required input to `/swap` would eliminate all three. We rebuild
`prepareSwapRequest` ourselves
([`packages/core/src/trading.ts`](./packages/core/src/trading.ts)) and
strongly recommend the API ship something like it as the canonical path.

### Hidden-mandatory header: `x-universal-router-version: 2.0`

The skill mentions it; the docs gateway page does not list it as required
in the OpenAPI shape (because there is no OpenAPI shape — see below). We
caught this only because the skill's curl example included it. Missing
this header silently routes you to the legacy v1 router which is
deprecated. Make it a 400 if absent, or a default in the gateway.

### `swapStatus` endpoint shape is wrong in informal docs

Our first implementation of `swapStatus` called `GET /swaps/status` with
singular `txHash` / `orderHash` query params (we copied the shape from a
plan we'd written by reading prose docs). codex review of our PR caught
this: the actual canonical route is `GET /swaps?txHashes=…&chainId=…`
(repeated `txHashes` keys for the array form), and UniswapX orders use
`GET /orders` with `orderId`/`orderIds`. Fixed in
[`a9dae44`](https://github.com/estmcmxci/trust-swap/commit/a9dae44116a709c6a8f6069df4fd9a5d154d0624).
Verified against `/v1/swaps?txHashes=0xfc2c…0aa0&chainId=8453` returning
`{ requestId, swaps: [{ status: "SUCCESS", swapType: "CLASSIC", txHash, swapId }] }`
on a real Base tx.

### Smart-account composition + Permit2 is a UX cliff

When you wrap Universal Router via your own contract (`TrustSwapRouter →
UR.call(calldata)`), `msg.sender` from UR's perspective is your wrapper,
not the user. Permit2 signatures signed by the user-as-`from` still work
because UR validates the permit's signed `from` field, not msg.sender —
but this isn't documented anywhere we could find. We had to read the
Universal Router contract to confirm. For ERC20-input swaps via wrappers
this is the difference between "trivial" and "we'll need to teach every
integrator how Permit2 actually works."

### Quote freshness collides with multi-step pre-flight

Quotes expire fast (~30s). Our pipeline does: TRL resolve → RiskPolicy
fetch → gate → oracle attest → quote → encode → user-op → bundler.
That's 8 RTTs. Even on a happy network day, ~10s is plausible. Live, with
ENS RPCs sometimes flaking and oracles re-resolving both sides, we're
right against the freshness window. The quote is the first thing you'd
want to *commit to* before doing the slow stuff (attestations,
delegations), not the last.

**Proposal:** a **pre-flight reservation** mode where `/quote?reserve=true`
returns a `reservedQuoteId` valid for 5 minutes (longer than 30s). The
caller commits to that ID via `/swap?quoteId=…`; the API guarantees the
output amount is at least the reserved value or refuses. Charges a small
LP-funded "freshness premium" on the difference if rates moved.

### No way to bind a pre-flight check to a quote

We built an off-chain oracle that re-resolves both sides, signs an
attestation tying the swap to the (swapper, recipient, tier, expiresAt,
nonce) tuple. Our on-chain router verifies the signature before
forwarding. *This entire layer would be replaced by Trading API* if the
quote response could carry an opaque `recipient-attestation` field that
flows through `/swap`'s output calldata immutably. Then any verifier
(reputation provider, KYC service, AML check, on-chain compliance hook)
could attach to a quote and have its result enforced at settlement.

### Pimlico ↔ ZeroDev RPC mismatch (not Trading API's fault, but worth flagging)

When a smart-account stack (Namera/ZeroDev) asks for a user-op gas price,
ZeroDev's kernel client defaults to the proprietary
`zd_getUserOperationGasPrice` RPC method. Pimlico — the dominant free
bundler — doesn't implement it. ZeroDev's free tier paywalls Base
mainnet. We solved this by bypassing ZeroDev's `createSessionKeyClient`
helper and building the kernel client directly with a
`pimlico_getUserOperationGasPrice` override
([`packages/cli/src/utils/signer.ts`](./packages/cli/src/utils/signer.ts)).
Trading API isn't the cause, but Trading API integrations sit downstream
of this and most agentic-swap demos die at the bundler layer for
exactly this reason. **A native AA-batched calldata endpoint
(`POST /swap_aa`)** that returns a Batch with the right `userOperation`
shape for any-bundler consumption would unblock dozens of
yet-to-be-built wallets.

## Bugs / docs gaps

- **No OpenAPI spec exposed at `/v1/openapi.json`** (returns 403). Every
  consumer reverse-engineers the schema from prose. Publishing the spec —
  even gated behind API key — would unlock typed clients for free.
- **No `llms.txt` / `llms-full.txt` at `developers.uniswap.org/`.** The
  agent-readable surface (`Uniswap/uniswap-ai`) is fantastic but you have
  to know to look for it. A one-line `llms.txt` at the docs root pointing
  at the SKILL.md collection would unblock every AI-native build tool.
- **`api-reference` documents endpoints (`/swaps`, `/orders`, EIP-7702
  calldata, `/send`, swappable/bridgable tokens) that the
  `swap-integration` SKILL.md doesn't cover.** Skill coverage trails the
  API. Agents using only the skill don't know about half the available
  surface.
- **The deprecated v1 Universal Router address
  (`0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD`) is still in lots of
  third-party READMEs.** A canonical "current addresses" page in the
  docs (or — better — a `GET /v1/contracts?chainId=8453` endpoint) would
  prevent stale-address bugs.
- **`uniswap-ai` and `ai-toolkit` are easy to confuse.** Externally we
  thought `ai-toolkit` was the integration skill set. It's actually
  internal Uniswap dev tooling (Claude Code slash commands etc.). A
  one-sentence disambiguation in either README would help.

## Missing endpoints / what we wished existed

In rough priority order. The first three would have eliminated about 60%
of TrustSwap's custom infrastructure:

1. **ENS-typed inputs.** Accept `swapper`, `recipient`, `tokenIn`,
   `tokenOut` as ENS names alongside `0x` addresses. Server-side
   resolution. Return both the resolved address AND the canonical name in
   the response so clients can render trust UI without re-resolving.
   Optionally surface ENS metadata: ENSIP-25 agent registration, ENSIP-26
   `agent-context` records, AIP manifest pointers.

2. **An `attestation` opaque field on `/quote` and `/swap`.** A signed
   blob the caller produces (using whatever attestation format they want
   — EIP-712, EIP-191, raw secp256k1) that the API carries through
   immutably and includes verbatim in the swap calldata. Verifiers (KYC
   gates, reputation systems, compliance hooks) get a consistent place to
   anchor proofs. Today every consumer like us has to wrap the calldata
   in our own router to bind an attestation, which makes the attestation
   contract address — not Universal Router — the canonical
   `to`. That fragments the verification ecosystem.

3. **A `quote_id` field returned by `/quote` and accepted as the only
   required input to `/swap`.** Three of our integration bugs traced to
   the spread-the-quote-strip-permitData footgun. Opaque IDs eliminate
   the entire shape-mismatch class of bugs.

4. **Webhook for swap completion.** Currently every consumer polls
   `/swaps?txHashes=…`. A `webhook_url` field on `/swap` (or a separate
   `POST /swap_subscriptions`) firing one POST when the swap reaches a
   terminal state would save thousands of polls per active session.

5. **Native AA-batched calldata endpoint.** `POST /swap_aa?bundler=…`
   returns a `{ batches: [{ chainId, atomic, calls: [...] }] }` payload
   ready for ZeroDev / Namera / Safe / 7702 wallets to consume directly.
   Eliminates the bundler-RPC-mismatch class of bugs (see Pimlico/ZeroDev
   above) and the manual approve+swap stitching every AA-aware wallet
   currently does.

6. **Batched `check_approval + quote`.** We always need both. A combined
   call halves the latency for the common path.

7. **Rate-limit headers.** `X-RateLimit-Remaining` / `X-RateLimit-Reset`
   on every response. We hit 429s without warning during a `swappable_tokens`
   burst — couldn't backoff intelligently because we didn't know how
   close we were until we crossed the line.

8. **`ENS_RPC_URL` (or equivalent) in the Trading API's runtime config.**
   When ENS-typed inputs land (point 1), the API will need to do ENS
   resolution from the gateway. Letting integrators specify their own
   ENS RPC (Cloudflare's gateway, Alchemy, etc.) prevents the API from
   becoming a single point of failure for resolution.

## DX friction

### `permitData` handling needs three different shapes

Three routing types each want `permitData` handled differently:
- **CLASSIC**: signature + permitData together in `/swap` body, or both
  omitted
- **UniswapX (DUTCH_V2/V3/PRIORITY)**: signature only; permitData stays
  local (used for off-chain signing only)
- **Smart-account wrappers**: typically neither, since the wrapper does
  Permit2 in its own ERC20 plumbing

A canonical helper — published at `@uniswap/trading-api-client` —
that takes a quote response + optional signature and returns the right
body shape per route would save every integrator a day of debugging. We
shipped one
([`prepareSwapRequest`](./packages/core/src/trading.ts)). It's 30 lines
and the API team would write it more authoritatively.

### Discriminated quote response, but no shipped types

Every consumer redefines `ClassicQuote | UniswapXQuote` from prose. We did.
Shipping `@uniswap/trading-api-types` would let TypeScript catch the
"can't read `output.amount` from a UniswapX quote" runtime crash at
build time. Until then, every integrator that doesn't bother runs the
risk of a 500 in front of a user.

### CORS

The gateway returns 415 on `OPTIONS` preflight, so direct browser
`fetch()` is impossible. Every frontend has to proxy through their own
server. Documented in the skill but not on the API reference page.
Either fix the preflight (cleanest) or document on the API reference
that browser direct calls are unsupported (next-cleanest).

### `gasFee` vs `gasFeeUSD` on UniswapX

UniswapX is gasless for the swapper, but the response still includes
`gasFee` / `gasFeeUSD` fields that some integrators display. These are
the *filler*'s gas, not the swapper's. We had to read the prose docs to
realize this. Either rename (`fillerGasFee*`) or document inline.

---

## Where ENS could materially aid the Trading API

This deserves its own section because we're submitting to both the
Uniswap and ENS prize tracks and we've seen the seam between them up
close. A focused list, ordered by integration effort:

### Tier 1 — drop-in additions

- **Accept ENS names in `swapper`, `recipient`, `tokenIn`, `tokenOut`
  fields.** Server-side resolution. Return both `address` and `ensName`
  on the response. Today every wallet, every agent, every aggregator
  re-implements the same `viem.getEnsAddress` calls.
- **Surface ENS reverse records on `/quote` responses.** When a user
  swaps to a 0x address, return the primary ENS name (if one exists) so
  clients can render "swap to vitalik.eth" instead of "swap to 0xd8d…".
  Two-line UX upgrade.
- **Accept ENS subnames as token aliases.** `usdc.tokens.uniswap.eth →
  0x833589…` becomes a registry the community can extend without
  Uniswap's editorial gatekeeping. ENS already does this work (Coinbase's
  `usdc.cb.id` model proves it).

### Tier 2 — opens new product surfaces

- **Read ENSIP-25 (Agent Registration) on resolution.** When `swapper`
  resolves to an ENS with an `agent` text record, surface its ERC-8004
  agent ID, registry chain, and metadata in the `/quote` response. Lets
  Uniswap natively display "this swap was made by [agent name], agent
  #24994 on Base" — turning Trading API into the de-facto agentic-trade
  layer the Uniswap prize track exists to encourage.
- **Read ENSIP-26 (Discovery) on resolution.** Surface `agent-context`,
  `agent-endpoint` records. Lets agent-aware tools route quote requests
  through the agent's own endpoint when one is published — useful for
  compliance / KYC / preference signaling without a separate
  out-of-band protocol.
- **Recognize AIP manifest records.** When `swapper` ENS publishes an
  AIP manifest (the agent identity proof spec), surface its hash +
  signature in the quote response. Verifiers can use it without
  re-resolving.

### Tier 3 — composes ENS into Uniswap as a primitive

- **An attestation field that ENS-derived oracles can populate.** Today
  we built our own oracle to gate swaps by ENS-derived trust scores.
  Trading API could accept an attestation signed by any trusted oracle
  (ours, ChainalysisOracle, Coinbase's verified-user attester) and bind
  it to the quote. Result: any ENS-aware reputation provider
  contributes settlement-grade trust to Uniswap's UX without redeploying
  pools or contracts.
- **Subname-as-tier convention.** The pattern we landed on for
  TrustSwap — subnames inheriting their parent's TRL profile — is
  generalizable. A `kernel.alice.eth` operates on behalf of `alice.eth`;
  a Trading API that recognizes this saves every smart-account wallet
  from repeating the kernel-vs-identity-binding work we did this week.
- **Cross-chain ENS via ENSIP-19 reverse records.** When the same
  `alice.eth` is used as recipient across chains, Trading API should
  resolve the chain-specific reverse address. Currently we'd have to
  pre-resolve and feed an `0x...` per chain. ENS supports this; Trading
  API doesn't reach for it.

### Concrete ask

We propose a single API-versioning header
(`x-trading-api-features: ens-typed-inputs,attestations`) that opts
integrators into a cleanly-separable schema. Backwards-compatible. The
features land independently. Shipping just `ens-typed-inputs` would
have eliminated about 30% of TrustSwap's custom code.

---

## Phase 3 — bidirectional RiskPolicy on ENS (post-router observations)

After Phase 2 shipped the on-chain router + oracle, Phase 3 added
**RiskPolicy as an ENS text record** (`agent-risk-policy`) and a
bidirectional check so the oracle enforces both swapper's and recipient's
declared constraints before signing the attestation. A few observations
from running this end-to-end against the deployed oracle:

### Bidirectional attestation needs symmetric metadata in the swap payload

The oracle's bidirectional check views each side as receiving something:
recipient receives `tokenIn`/`amountIn`, swapper receives
`tokenOut`/`amountOut`. We had to add `amountOut` to our own attestation
request schema because the existing `quote.output.amount` is denominated in
the destination token's base units — useful for rendering, not for a
size-cap comparison against a USD-denominated policy. **A single
canonical USD-or-stable amount on both sides of every quote response would
make any attestation-style gating layer 10× simpler to author.** Today we
each derive it ourselves; tomorrow Uniswap could surface it once.

### ENS text records work great for policy distribution; ENS *reads* are the bottleneck

`tru policy publish` writes a JSON-encoded RiskPolicy to the
`agent-risk-policy` text record at the canonical resolver. The publish
path is clean — viem's `walletClient.writeContract` against the ENS
PublicResolver is a single tx, ~$2-3 mainnet gas
([`0x4c73ca73…51191`](https://etherscan.io/tx/0x4c73ca73ba4ffacc459b3ce4d9880f9731d1774d83ed8b1d59a9e0fb46351191)).
The **read** path is where reality bites for production gating:

- **Read-replica lag.** The same Alchemy endpoint that landed our publish
  tx returned `text(node, "agent-risk-policy")` as `""` for ~30 seconds
  after inclusion at `latest` blockTag — fine at `--block <inclusion>`
  immediately. This isn't an ENS bug; it's normal behavior of large RPC
  providers running multiple read replicas behind their gateway. But it
  means any Trading-API-style integration that reads ENS records on the
  hot path needs to pin to `finalized` blockTag (~12s steady-state cost)
  or accept that an attacker could race a freshly-published stricter
  policy by sliding their swap into the propagation window.

- **Synthesis resolver flake.** The Trust Resolution Layer fires 5+
  parallel ENS queries per profile (Personhood, Identity, Context,
  Manifest, Skill). Under load, individual queries return spurious nulls
  — most commonly `address: null` for a name that has a real address
  record, occasionally `tier=none` for a verified profile. Our local
  orchestrator has a single-purpose `resolveAddress` fallback that
  recovers cleanly; the deployed Cloudflare Worker oracle does not yet,
  so a single transient null returns a 400 to the client. Sub-issue
  filed (TRU-76).

If Trading API ever ships **server-side ENS resolution** (per Tier 1
above), it will face exactly these two issues and need to choose between
strict (finalized + retries, slower) and loose (latest + best-effort,
flaky). Worth a thought now, before the API surface commits.

### Live evidence captured

`scripts/test-bidirectional-policy.ts` + `pnpm test:phase-3` exercises
the deployed oracle with four scenarios against a real on-chain
RiskPolicy
([`kernel.emilemarcelagustin.eth`](https://app.ens.domains/kernel.emilemarcelagustin.eth?tab=records)):

- $1 USDC inbound, all checks satisfied → 200 + signed EIP-191 attestation
- $200 inbound exceeds $100 cap → 403 with `maxAcceptedSize` error
- DAI inbound vs USDC-only accept-list → 403 with token error
- Recipient with no policy → 200, recipient-side check no-ops

Artifacts archived under `infra/test-runs/phase-3/`. The recipient-side
of the bidirectional check is now end-to-end verified against real ENS
records, not just unit-tested with mocks.

### Unit mismatch — known seam in any USD-cap-style policy

Our RiskPolicy `maxAcceptedSize` is denominated in 6-decimal USDC base
units (matches the off-chain tier-bucket table). The oracle and
orchestrator originally compared it directly against `amountIn` /
`amountOut`, which are in the *swap token's* native base units. They
line up when the swap involves USDC and diverge wildly otherwise (1 WETH
= 10^18 base units gets compared against 100_000_000 = $100).

**Resolved (TRU-77)**: both orchestrate and the oracle now USD-normalize
the inbound amount via a `tokenIn → USDC` Trading API quote before the
size check. Skips the API call when the token already IS USDC. The
oracle Worker requires a `UNISWAP_API_KEY` wrangler secret for this; if
unset, the size check is skipped (logged) and tier/token enforcement
still binds. Documented in `tru policy publish --max-size` help text and
covered by `orchestrate.test.ts` non-USDC fixtures.

The structural concern that motivated this still stands: **any policy
layer expressing USD caps over a multi-token surface needs an
authoritative USD-equivalent on every quote, or every consumer redoes
the work.** This is exactly the kind of concern an attestation-aware
Trading API would smooth over by returning `inputUsd` / `outputUsd`
fields alongside `gasFeeUSD`.

---

## Closing thought

The Trading API is the right product. The footguns are mostly shape
issues (response/request envelope conventions, deprecated enum values,
CORS) that an OpenAPI spec + a typed client would smooth over in a week
of work. The structural gap is that **Uniswap's data model treats
addresses as opaque** when ENS has been the canonical identity layer on
Ethereum for years. Closing that gap doesn't require new pools, new
hooks, or new contracts — it requires the gateway to do an
`getEnsAddress` call and pass through some metadata. Doing it there
instead of forcing every consumer to redo it would be the highest-
leverage docs/API change Uniswap could ship next quarter.

Composing TrustSwap on top was rewarding precisely because the
underlying pieces are this clean. Thanks for reading.

— TrustSwap, built at the Synthesis hackathon.
Repo: [`estmcmxci/trust-swap`](https://github.com/estmcmxci/trust-swap)
