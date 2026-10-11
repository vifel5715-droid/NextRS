import type { NextConfig } from "next";

// Pages get a per-request nonce Content-Security-Policy from proxy.ts. API
// routes only ever return JSON, PDFs, or an event stream — nothing that
// should execute — so they get a deny-everything policy instead.
const apiContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  agentRules: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ]
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: apiContentSecurityPolicy },
        ]
      },
      {
        // The deny-all policy would stop Chrome's built-in PDF viewer from
        // rendering an attachment opened inline. Next.js applies the last
        // matching rule for a header, so attachment responses get a
        // locked-down policy that still allows the viewer.
        source: "/api/:type(item-request|reimbursement-request)/:id/attachment",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" },
        ]
      }
    ];
  }
};

export default nextConfig;
