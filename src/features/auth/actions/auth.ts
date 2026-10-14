"use server";

import type { User } from "@/types";
import { RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/request-context";
import { clearSessionCookie, getCurrentUser, setSessionCookie } from "@/lib/session";
import { authenticate, signOutEverywhere } from "@/features/auth/services/auth-service";
import { loginSchema } from "@/features/auth/schemas/login";

export type LoginResult =
  | { success: true; user: User }
  | { success: false; error: "INVALID_INPUT" | "INVALID_CREDENTIALS" | "UNAVAILABLE" }
  | { success: false; error: "RATE_LIMITED"; message: string };

export async function loginAction(
  username: string,
  password: string,
  rememberMe = false
): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({ username, password });
  if (!parsed.success) return { success: false, error: "INVALID_INPUT" };

  try {
    const result = await authenticate(parsed.data, await getClientIp());
    if (!result.ok) return { success: false, error: "INVALID_CREDENTIALS" };
    await setSessionCookie(result.user.id, result.sessionVersion, { persistent: rememberMe === true });
    return { success: true, user: result.user };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { success: false, error: "RATE_LIMITED", message: error.message };
    }
    // Database down, misconfigured DATABASE_URL, etc. Logged in full here;
    // the browser only learns that sign-in is unavailable, which it can tell
    // apart from its own network failure (a thrown fetch).
    logger.error("Login failed with a server error", { error });
    return { success: false, error: "UNAVAILABLE" };
  }
}

export async function getCurrentUserAction(): Promise<User | null> {
  return getCurrentUser();
}

/**
 * Revokes the session server-side (not just the cookie), so a copied token
 * stops working too. This signs the user out on every device.
 */
export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await signOutEverywhere(user, await getClientIp());
  await clearSessionCookie();
}
