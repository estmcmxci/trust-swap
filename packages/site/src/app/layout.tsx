import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TrustSwap — reputation-graded settlement on Uniswap",
  description:
    "Settle with anyone the chain says you should. Reputation-graded gated routing through TrustSwapRouter on Base.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-zinc-800 px-6 py-4">
          <nav className="mx-auto flex max-w-5xl items-center justify-between">
            <Link href="/" className="text-sm font-bold tracking-tight">
              TrustSwap<span className="text-zinc-500">.eth</span>
            </Link>
            <div className="flex gap-6 text-sm text-zinc-400">
              <Link href="/swap" className="hover:text-zinc-100">
                /swap
              </Link>
              <Link href="/policy" className="hover:text-zinc-100">
                /policy
              </Link>
              <a
                href="https://github.com/estmcmxci/trust-swap"
                className="hover:text-zinc-100"
                target="_blank"
                rel="noreferrer"
              >
                github
              </a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 py-10 text-xs text-zinc-600">
          Router{" "}
          <a
            className="hover:text-zinc-400"
            href="https://basescan.org/address/0x4aFa38bC5A775B08826f8644327C0c435fF5BD3a"
            target="_blank"
            rel="noreferrer"
          >
            0x4aFa…BD3a
          </a>{" "}
          on Base · oracle{" "}
          <a
            className="hover:text-zinc-400"
            href="https://trust-swap-oracle.estmcmxci.workers.dev/healthz"
            target="_blank"
            rel="noreferrer"
          >
            workers.dev
          </a>
        </footer>
      </body>
    </html>
  );
}
