import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce Content-Security-Policy for pages.
 *
 * Replaces the static policy that allowed `script-src 'unsafe-inline'`
 * (flagged by the MDN HTTP Observatory). Next.js reads the nonce from the
 * CSP request header and stamps it on its own framework/page scripts during
 * server rendering, so only scripts this server emitted can run;
 * 'strict-dynamic' lets those load the chunks they import.
 *
 * style-src keeps 'unsafe-inline' deliberately and has NO nonce: the UI uses
 * React `style={{...}}` attributes throughout, and browsers ignore
 * 'unsafe-inline' whenever a nonce is present in the same directive.
 *
 * Pages must render dynamically for this to work — see app/layout.tsx.
 * API routes are excluded here and get their own policy in next.config.ts.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const isHttps =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // ws: only for the dev server's hot reload; production needs same-origin
    // fetches (Server Actions) and the /api/events stream only.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only behind HTTPS (Railway) — upgrading on plain-HTTP LAN/dev access
    // would break every subresource.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes and static build assets.
      source: "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
