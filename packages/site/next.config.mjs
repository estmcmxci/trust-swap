/**
 * Next.js config for the TrustSwap site.
 *
 * `transpilePackages` lets us import workspace packages (`@trust-swap/core`,
 * `@synthesis/resolver`) directly from source where appropriate. Both
 * publish ESM with `.js` import extensions, so Next's loader handles them
 * out of the box once they're explicitly transpiled.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@trust-swap/core` is a workspace package we want bundled. Synthesis
  // reaches for Node-only modules through its transitive deps
  // (merkletreejs etc.), so we externalize it on the server so Next
  // doesn't try to inline native bindings.
  transpilePackages: ["@trust-swap/core"],
  serverExternalPackages: ["@synthesis/resolver"],
};

export default nextConfig;
