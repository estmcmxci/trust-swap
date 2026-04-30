"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handle() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* no-op — clipboard not available */
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hairline-strong)] bg-white px-2.5 py-1.5 text-[11.5px] font-medium tracking-[-0.01em] text-ink-soft transition-colors duration-150 hover:bg-paper-subtle hover:text-ink focus-visible:outline-none focus-visible:shadow-ring ${className}`}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-tier-verified" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
