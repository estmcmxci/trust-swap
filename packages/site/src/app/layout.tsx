import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrustSwap — reputation-graded settlement on Uniswap",
  description:
    "Settle with anyone the chain says you should. Reputation-graded gated routing through TrustSwapRouter on Base.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 mx-auto w-full max-w-6xl px-6 lg:px-8 py-10 lg:py-14">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
