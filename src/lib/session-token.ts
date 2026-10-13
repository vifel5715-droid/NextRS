import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, stateless session token: base64url(JSON payload) + "." + HMAC-SHA256.
 *
 * `ver` is the user's session_version at sign-in. lib/session.ts rejects a
 * token whose ver no longer matches the database, so bumping the column
 * (logout, password change) revokes every outstanding token for that user.
 * Tokens issued before `ver` existed carry none and are read as version 0.
 *
 * Pure (no cookies, no database) so it can be unit tested directly.
 */
export interface SessionPayload {
  sub: string;
  exp: number;
  ver: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_SECRET_BYTES = 32;

export function readSessionSecret(value: string | undefined = process.env.SESSION_SECRET): string {
  if (!value || Buffer.byteLength(value) < MIN_SECRET_BYTES) {
    throw new Error(`SESSION_SECRET must contain at least ${MIN_SECRET_BYTES} bytes.`);
  }
  return value;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSessionToken(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SessionPayload | null {
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra !== undefined) return null;

  const expectedSignature = Buffer.from(sign(payload, secret), "base64url");
  const actualSignature = Buffer.from(providedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { sub, exp, ver = 0 } = parsed as Record<string, unknown>;
  if (
    typeof sub !== "string" ||
    !UUID_RE.test(sub) ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp) ||
    exp <= nowSeconds ||
    typeof ver !== "number" ||
    !Number.isSafeInteger(ver) ||
    ver < 0
  ) {
    return null;
  }
  return { sub, exp, ver };
}
