import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, readJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIpFrom } from "@/lib/request-context";
import { setSessionCookie } from "@/lib/session";
import { authenticate } from "@/features/auth/services/auth-service";
import { loginSchema } from "@/features/auth/schemas/login";

export const runtime = "nodejs";

/**
 * POST /api/auth/login — `{ username, password }` → `{ user }` and the
 * session cookie. Same throttling, timing protection and audit trail as the
 * login Server Action (both call features/auth/services/auth-service.ts).
 */
export const POST = withApiHandler(async (request) => {
  assertSameOrigin(request);
  const input = loginSchema.parse(await readJsonBody(request));
  const result = await authenticate(input, clientIpFrom(request.headers));
  if (!result.ok) return apiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  await setSessionCookie(result.user.id, result.sessionVersion);
  return NextResponse.json({ user: result.user });
});
