#!/usr/bin/env bash
# Phase 1 end-to-end validation (TRU-26).
#
# Runs the canonical `tru swap` against live ENS for two scenarios:
#   1. Allow path: emilemarcelagustin.eth (tier=full when manifest layer is healthy)
#   2. Deny path:  nick.eth (tier=none — gate halts before quote)
#
# Verifies:
#   - exit 0 on allow, exit 1 on deny
#   - allow path produces a quote + router calldata + synthetic txHash
#   - deny path halts at gate-deny without reaching the oracle/Trading API
#   - --dry-run never broadcasts (no signer.execute call, synthetic 0x000... hash)
#
# Usage:
#   pnpm e2e:phase1
#
# Requires: UNISWAP_API_KEY in .env (loaded automatically by tru).
# Phase 2 update: ORACLE_URL points at the real deployed Worker, so the
# allow path now exercises the real /attest handler (still no broadcast in
# dry-run mode — orchestrate only encodes the gatedSwap calldata). The deny
# path halts at gate-deny client-side before the oracle is reached.

set -uo pipefail

cd "$(dirname "$0")/.."

# Colors for the report
B="\033[1m"; G="\033[32m"; R="\033[31m"; Y="\033[33m"; D="\033[2m"; N="\033[0m"

TRU="node packages/cli/dist/index.js"
LOG_DIR="$(mktemp -d)"
PASS=0
FAIL=0

assert() {
  local label="$1"; local expected="$2"; local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo -e "  ${G}✓${N} ${label}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${R}✗${N} ${label} ${D}(expected ${expected}, got ${actual})${N}"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local label="$1"; local needle="$2"; local file="$3"
  if grep -qF -- "$needle" "$file"; then
    echo -e "  ${G}✓${N} ${label}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${R}✗${N} ${label} ${D}(expected output to contain '${needle}')${N}"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local label="$1"; local needle="$2"; local file="$3"
  if grep -qF -- "$needle" "$file"; then
    echo -e "  ${R}✗${N} ${label} ${D}(unexpected match for '${needle}')${N}"
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${G}✓${N} ${label}"
    PASS=$((PASS + 1))
  fi
}

# -----------------------------------------------------------------------------
echo -e "\n${B}== TRU-26 Phase 1 E2E ==${N}\n"
echo -e "${D}Logs: ${LOG_DIR}${N}\n"

# -----------------------------------------------------------------------------
echo -e "${B}[1] Allow path: emilemarcelagustin.eth (mock oracle, dry-run, --noLineage)${N}"
echo -e "${D}    The real oracle's swapper-address-match check rejects ephemeral signers; the mock${N}"
echo -e "${D}    is the only way to assert full happy-path encoding without ENS-controlled keys.${N}"
ALLOW_LOG="${LOG_DIR}/allow.txt"
ORACLE_URL= $TRU swap emilemarcelagustin.eth \
  --amount 0.5 \
  --signer local \
  --dry-run \
  --noLineage \
  > "$ALLOW_LOG" 2>&1
ALLOW_EXIT=$?
assert "exit code 0 on allow" "0" "$ALLOW_EXIT"
assert_contains "trust profile printed" "Recipient:" "$ALLOW_LOG"
assert_contains "trust tier shown" "Trust Tier:" "$ALLOW_LOG"
assert_contains "gate allowed" "✓ Gate" "$ALLOW_LOG"
assert_contains "attestation emitted" "Attestation:" "$ALLOW_LOG"
assert_contains "swapperTier on attestation" "swapperTier" "$ALLOW_LOG"
assert_contains "quote summary printed" "Quote (" "$ALLOW_LOG"
assert_contains "router calldata produced" "routerCalldata:" "$ALLOW_LOG"
assert_contains "dry-run banner" "DRY RUN" "$ALLOW_LOG"
assert_contains "synthetic txHash returned" "0x0000000000000000000000000000000000000000000000000000000000000000" "$ALLOW_LOG"
assert_not_contains "no real broadcast happened" "https://basescan.org/tx/0x0000" "$ALLOW_LOG"
assert_not_contains "no halt on allow path" "✗ Halted at" "$ALLOW_LOG"

# -----------------------------------------------------------------------------
echo -e "\n${B}[2] Deny path: nick.eth (tier=none → halt before oracle/quote)${N}"
DENY_LOG="${LOG_DIR}/deny.txt"
$TRU swap nick.eth \
  --amount 0.5 \
  --signer local \
  --dry-run \
  > "$DENY_LOG" 2>&1
DENY_EXIT=$?
assert "exit code 1 on deny" "1" "$DENY_EXIT"
assert_contains "trust profile resolved" "Recipient:" "$DENY_LOG"
assert_contains "tier=none in log" "none" "$DENY_LOG"
assert_contains "gate denied" "Gate DENIED" "$DENY_LOG"
assert_contains "halted at gate-deny" "gate-deny" "$DENY_LOG"
assert_contains "onboarding hint printed" "register on AgentBook" "$DENY_LOG"
assert_not_contains "oracle was NOT reached" "Attestation:" "$DENY_LOG"
assert_not_contains "Trading API was NOT reached" "Quote (" "$DENY_LOG"
assert_not_contains "no router calldata" "routerCalldata:" "$DENY_LOG"

# -----------------------------------------------------------------------------
echo -e "\n${B}[3] Configuration threading (TRU-58 wire-up)${N}"
echo -e "${D}    With ORACLE_URL and TRUST_SWAP_ROUTER_ADDRESS in env, both should appear${N}"
echo -e "${D}    in the CLI banner. Whether the oracle is actually reached on any given${N}"
echo -e "${D}    run depends on the synthesis resolver's address-resolution health (upstream).${N}"
WIRE_LOG="${LOG_DIR}/wire.txt"
$TRU swap emilemarcelagustin.eth \
  --amount 0.5 \
  --signer local \
  --dry-run \
  --noLineage \
  --caller-ens emilemarcelagustin.eth \
  > "$WIRE_LOG" 2>&1
assert_contains "real oracle URL threaded from env" "trust-swap-oracle.estmcmxci.workers.dev" "$WIRE_LOG"
assert_contains "deployed router address threaded from env" "0x3AEFfbAA88186E557eADdCf6bb57C536f3e40925" "$WIRE_LOG"
assert_not_contains "no placeholder address leakage" "0x0000000000000000000000000000000000000000" "$WIRE_LOG"

# -----------------------------------------------------------------------------
echo -e "\n${B}== Result ==${N}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${G}${PASS}/${TOTAL} checks passed.${N} TRU-26 acceptance verified."
  exit 0
else
  echo -e "${R}${FAIL}/${TOTAL} checks failed.${N} See ${LOG_DIR} for full output."
  exit 1
fi
