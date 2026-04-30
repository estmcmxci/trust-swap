"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, SparkleIcon } from "@/components/ui/icons";
import { shortAddr } from "@/lib/format";
import type {
  SiteToken,
  TokensErrorResponse,
  TokensResponse,
} from "@/lib/token-types";

interface TokenPickerProps {
  chainId?: number;
  /** Selected token address (lowercased canonical 0x). */
  value: string;
  onChange: (token: SiteToken) => void;
  label?: string;
  hint?: string;
  required?: boolean;
}

/**
 * Click-to-open token picker. Renders the currently-selected token as a
 * chip in the closed state; expands to a panel with search + a curated +
 * full token list when clicked. Falls back to a hardcoded list if the
 * Trading API is unreachable.
 */
export function TokenPicker({
  chainId = 8453,
  value,
  onChange,
  label = "Token",
  hint,
  required = false,
}: TokenPickerProps) {
  const [tokens, setTokens] = useState<SiteToken[]>([]);
  const [source, setSource] = useState<TokensResponse["source"] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch the token list once per session (cached server-side already).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/tokens?chainId=${chainId}`);
        const data = (await res.json()) as TokensResponse | TokensErrorResponse;
        if (cancelled) return;
        if (!res.ok || "error" in data) {
          setTokens([]);
        } else {
          setTokens(data.tokens);
          setSource(data.source);
        }
      } catch {
        if (!cancelled) setTokens([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = useMemo(
    () => tokens.find((t) => t.address.toLowerCase() === value.toLowerCase()),
    [tokens, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [tokens, query]);

  const curated = filtered.filter((t) => t.curated);
  const others = filtered.filter((t) => !t.curated);

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted">
          {label}
          {required && <span className="ml-1 text-gold-500">*</span>}
        </span>
        {source === "fallback" && (
          <span
            className="font-mono text-[10px] text-gold-700"
            title="Trading API unreachable; using curated fallback list"
          >
            curated fallback
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-ink-faint focus-visible:outline-none focus-visible:shadow-ring focus-visible:border-brand-500 ${
          open ? "border-brand-500 shadow-ring" : "border-[color:var(--hairline-strong)]"
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {selected ? (
            <>
              <TokenAvatar token={selected} />
              <span className="flex flex-col min-w-0">
                <span className="text-[14px] font-medium text-ink leading-tight">
                  {selected.symbol}
                </span>
                <span className="font-mono text-[11px] tabular text-ink-faint truncate">
                  {shortAddr(selected.address)}
                </span>
              </span>
            </>
          ) : loading ? (
            <span className="text-[13px] text-ink-faint">Loading tokens…</span>
          ) : (
            <span className="text-[13px] text-ink-faint">Select a token</span>
          )}
        </span>
        <Chevron open={open} />
      </button>
      {hint && (
        <span className="mt-1.5 block text-[11.5px] leading-snug text-ink-faint">
          {hint}
        </span>
      )}
      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-[color:var(--hairline-strong)] bg-white shadow-card-hover animate-fade-up">
          <div className="border-b border-[color:var(--hairline)] px-3.5 py-2.5">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by symbol, name, or address"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {tokens.length === 0 && !loading && (
              <div className="flex items-center gap-2 px-3 py-4 text-[12.5px] text-ink-faint">
                <SparkleIcon className="h-4 w-4 text-gold-500" />
                <span>
                  No tokens loaded. Set{" "}
                  <span className="font-mono">UNISWAP_API_KEY</span> to use
                  the live list.
                </span>
              </div>
            )}
            {curated.length > 0 && (
              <SectionLabel>Common pairs</SectionLabel>
            )}
            {curated.map((t) => (
              <TokenRow
                key={t.address}
                token={t}
                selected={t.address.toLowerCase() === value.toLowerCase()}
                onSelect={() => {
                  onChange(t);
                  setOpen(false);
                  setQuery("");
                }}
              />
            ))}
            {others.length > 0 && (
              <SectionLabel>
                All tokens
                <span className="ml-1.5 font-mono text-[10px] tabular text-ink-faint">
                  {others.length}
                </span>
              </SectionLabel>
            )}
            {others.map((t) => (
              <TokenRow
                key={t.address}
                token={t}
                selected={t.address.toLowerCase() === value.toLowerCase()}
                onSelect={() => {
                  onChange(t);
                  setOpen(false);
                  setQuery("");
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenRow({
  token,
  selected,
  onSelect,
}: {
  token: SiteToken;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 hover:bg-paper-subtle ${
        selected ? "bg-brand-50" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <TokenAvatar token={token} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-medium text-ink leading-tight">
            {token.symbol}
          </span>
          <span className="text-[11.5px] text-ink-faint truncate leading-tight">
            {token.name}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="hidden font-mono text-[10.5px] tabular text-ink-faint sm:inline">
          {shortAddr(token.address)}
        </span>
        {selected && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white">
            <CheckIcon className="h-3 w-3" />
          </span>
        )}
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
      {children}
    </div>
  );
}

function TokenAvatar({ token }: { token: SiteToken }) {
  // Logo with letter fallback. We don't fail on logo errors — most flows
  // will see the letter while logos load (or stay if they fail).
  const initial = token.symbol.charAt(0).toUpperCase();
  const seedColor = stringHashToColor(token.symbol);
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
      <span
        className="absolute inset-0 flex items-center justify-center text-[10.5px] font-semibold text-white"
        style={{ background: seedColor }}
        aria-hidden="true"
      >
        {initial}
      </span>
      {token.logoURI && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={token.logoURI}
          alt={token.symbol}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * Stable hash → HSL — gives every token a unique recognisable letter-bg
 * color when no logoURI is set. Same input always produces the same
 * color so users build mental association.
 */
function stringHashToColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 52%, 42%)`;
}
