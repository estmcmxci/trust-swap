import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

interface CodeBlockProps {
  /** Raw code/JSON string. */
  value: string;
  /** Optional eyebrow / label on the top bar (e.g. "agent-risk-policy"). */
  label?: string;
  /** Right-side meta on the top bar (byte counter etc.). */
  meta?: ReactNode;
  /** Whether to show the copy button. Default true. */
  copyable?: boolean;
  /** Whether to syntax-highlight as JSON. Default true if it parses; false otherwise. */
  highlight?: "json" | "shell" | "none";
  className?: string;
}

export function CodeBlock({
  value,
  label,
  meta,
  copyable = true,
  highlight = "json",
  className = "",
}: CodeBlockProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-paper-subtle/60 ${className}`}
    >
      {(label || meta || copyable) && (
        <div className="flex items-center justify-between gap-4 border-b border-[color:var(--hairline)] bg-white/70 px-4 py-2">
          {label && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              {label}
            </span>
          )}
          <div className="flex flex-1 items-center justify-end gap-3">
            {meta && <span className="text-[11.5px] text-ink-muted">{meta}</span>}
            {copyable && <CopyButton value={value} />}
          </div>
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed">
        <code className="text-ink">
          {highlight === "json" ? <Highlight code={value} /> : value}
        </code>
      </pre>
    </div>
  );
}

/**
 * Lightweight regex-based JSON highlighter. Avoids pulling in
 * Prism/Shiki for one demo page. Conservative — falls back to plain
 * text if the input isn't recognizable JSON shapes.
 */
function Highlight({ code }: { code: string }) {
  // Tokenize keys, strings, numbers, booleans, punctuation. Order matters:
  // strings first (so we don't accidentally re-color a key as a string).
  const out: ReactNode[] = [];
  const re =
    /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b\d+\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index > lastIndex) {
      out.push(code.slice(lastIndex, m.index));
    }
    if (m[1]) {
      out.push(
        <span key={key++} className="text-brand-700">
          {m[1]}
        </span>,
      );
    } else if (m[2]) {
      out.push(
        <span key={key++} className="text-tier-verified">
          {m[2]}
        </span>,
      );
    } else if (m[3]) {
      out.push(
        <span key={key++} className="text-gold-700">
          {m[3]}
        </span>,
      );
    } else if (m[4]) {
      out.push(
        <span key={key++} className="text-gold-600">
          {m[4]}
        </span>,
      );
    } else if (m[5]) {
      out.push(
        <span key={key++} className="text-ink-faint">
          {m[5]}
        </span>,
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < code.length) out.push(code.slice(lastIndex));
  return <>{out}</>;
}
