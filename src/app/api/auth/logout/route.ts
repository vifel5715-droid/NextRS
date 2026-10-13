import { assertSameOrigin, withApiHandler } from "@/lib/api-response";
import { clientIpFrom } from "@/lib/request-context";
import { clearSessionCookie, getCurrentUser } from "@/lib/session";
import { signOutEverywhere } from "@/features/auth/services/auth-service";

export const runtime = "nodejs";

/** POST /api/auth/logout — revokes the user's sessions and clears the cookie. Always 204. */
export const POST = withApiHandler(async (request) => {
  assertSameOrigin(request);
  const user = await getCurrentUser();
  if (user) await signOutEverywhere(user, clientIpFrom(request.headers));
  await clearSessionCookie();
  return new Response(null, { status: 204 });
});
