import "server-only";

import type { User } from "@/types";
import { UnauthorizedError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/session";

/**
 * The signed-in user plus a normalized role key, as every authorization
 * helper in lib/permissions.ts expects it.
 */
export interface AuthorizedUser extends User {
  /** Lowercased, trimmed role name. */
  roleKey: string;
}

export function toAuthorizedUser(user: User): AuthorizedUser {
  return { ...user, roleKey: user.role.trim().toLowerCase() };
}

/** Resolves the session cookie to a user, or throws UnauthorizedError (401). */
export async function requireUser(): Promise<AuthorizedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return toAuthorizedUser(user);
}
