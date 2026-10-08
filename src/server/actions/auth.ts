"use server";

import { eq, sql } from "drizzle-orm";
import { verifyPassword } from "@shared/utils/password";
import type { User } from "@shared/types";
import { getDb } from "../db";
import { rolePermissions, roles, users } from "../db/schema";
import { clearSessionCookie, getCurrentUser, setSessionCookie } from "../auth/session";

export type LoginResult =
  | { success: true; user: User }
  | { success: false; error: "INVALID_INPUT" | "INVALID_CREDENTIALS" };

export async function loginAction(username: string, password: string): Promise<LoginResult> {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim().length === 0 ||
    username.length > 254 ||
    password.length === 0 ||
    password.length > 1024
  ) {
    return { success: false, error: "INVALID_INPUT" };
  }

  const db = getDb();
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.username,
      passwordHash: users.password_hash,
      role: users.role,
      department: users.department,
    })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`)
    .limit(1);

  if (!account || !(await verifyPassword(account.passwordHash, password))) {
    return { success: false, error: "INVALID_CREDENTIALS" };
  }

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${account.role})`)
    .limit(1);

  const grants = role
    ? await db
        .select({
          key: rolePermissions.permission_key,
          canEdit: rolePermissions.can_edit,
        })
        .from(rolePermissions)
        .where(eq(rolePermissions.role_id, role.id))
    : [];

  const user: User = {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    department: account.department,
    permissions: grants.map((grant) => grant.key),
    editPermissions: grants.filter((grant) => grant.canEdit).map((grant) => grant.key),
  };

  await setSessionCookie(user.id);
  return { success: true, user };
}

export async function getCurrentUserAction(): Promise<User | null> {
  return getCurrentUser();
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
}
