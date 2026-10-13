import "server-only";

import { headers } from "next/headers";

/**
 * Best-effort client IP for throttling and audit entries.
 *
 * Behind the hosting proxy, X-Forwarded-For is "client, proxy1, ...": a
 * client can put anything at the front, but the right-most entry is the one
 * the hosting edge appended, so that is the one trusted. X-Real-IP (set by
 * nginx-style proxies) wins when present. Never used for authorization —
 * the per-username throttle is the primary brute-force control.
 */
export function clientIpFrom(requestHeaders: Pick<Headers, "get">): string | null {
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  const forwarded = requestHeaders.get("x-forwarded-for");
  const last = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  return last ? last.slice(0, 64) : null;
}

export async function getClientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}
