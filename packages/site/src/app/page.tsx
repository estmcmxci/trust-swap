import Link from "next/link";

export default function Landing() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Reputation-graded settlement on Uniswap.
        </h1>
        <p className="max-w-2xl text-zinc-400">
          Every swap routes through{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs">
            TrustSwapRouter
          </code>
          , an on-chain contract that verifies an off-chain trust attestation
          and applies tier-graded execution terms before forwarding to
          Uniswap&apos;s Universal Router. Each side publishes a{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs">
            RiskPolicy
          </code>{" "}
          on their ENS — the router enforces the intersection.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/swap"
          className="block rounded-md border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            /swap
          </div>
          <div className="mt-1 text-lg">Preview a gated swap</div>
          <div className="mt-2 text-sm text-zinc-400">
            Resolve any ENS counterparty, see their published RiskPolicy, and
            preview the tier-bucketed gate decision against a router floor.
          </div>
        </Link>
        <Link
          href="/policy"
          className="block rounded-md border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            /policy
          </div>
          <div className="mt-1 text-lg">Publish your RiskPolicy</div>
          <div className="mt-2 text-sm text-zinc-400">
            Editor for your own RiskPolicy. Coming with TRU-71. For now, use{" "}
            <code className="rounded bg-zinc-900 px-1 text-xs">
              tru policy publish
            </code>{" "}
            from the CLI.
          </div>
        </Link>
      </section>
    </div>
  );
}
