import "server-only";

import type { User } from "@/types";
import { RateLimitError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { recordAuditSafely } from "@/server/audit/audit-log";
import { usernameKey } from "@/server/policies/login-throttle-policy";
import { checkLoginThrottle, clearLoginFailures, recordLoginFailure } from "@/server/services/login-throttle";
import {
  findAccountByUsername,
  incrementSessionVersion,
  toUser,
} from "@/server/repositories/user-repository";
import type { LoginInput } from "@/features/auth/schemas/login";

/**
 * Sign-in business logic, shared by the login Server Action and the
 * /api/auth/login Route Handler. Neither caller touches password hashes.
 */
export type AuthenticateResult =
  | { ok: true; user: User; sessionVersion: number }
  | { ok: false; reason: "INVALID_CREDENTIALS" };

// Verified against when the username does not exist, so an unknown username
// costs the same argon2 work as a wrong password and response timing does not
// reveal which usernames exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing-equalization"));

/** @throws RateLimitError when the username or IP is over the failure limit. */
export async function authenticate(input: LoginInput, ip: string | null): Promise<AuthenticateResult> {
  const key = usernameKey(input.username);

  const throttle = await checkLoginThrottle(key, ip);
  if (throttle.limited) {
    await recordAuditSafely({ action: "auth.login_throttled", details: { username: key }, ip });
    throw new RateLimitError(throttle.retryAfterSeconds);
  }

  const account = await findAccountByUsername(input.username);
  const passwordMatches = account
    ? await verifyPassword(account.passwordHash, input.password)
    : (await verifyPassword(await getDummyHash(), input.password), false);

  if (!account || !passwordMatches) {
    await recordLoginFailure(key, ip);
    await recordAuditSafely({ action: "auth.login_failed", details: { username: key }, ip });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  await clearLoginFailures(key);
  await recordAuditSafely({
    action: "auth.login",
    actor: { id: account.id, name: account.name },
    entityType: "user",
    entityId: account.id,
    department: account.department,
    ip,
  });
  return { ok: true, user: await toUser(account), sessionVersion: account.sessionVersion };
}

/** Revokes every session of the user, on every device. */
export async function signOutEverywhere(user: { id: string; name: string }, ip: string | null): Promise<void> {
  await incrementSessionVersion(user.id);
  await recordAuditSafely({ action: "auth.logout", actor: user, entityType: "user", entityId: user.id, ip });
}
