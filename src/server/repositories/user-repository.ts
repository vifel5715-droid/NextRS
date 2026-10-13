import "server-only";

import { eq, sql } from "drizzle-orm";
import type { User } from "@/types";
import { getDb } from "@/lib/db";
import { rolePermissions, roles, users } from "@/db/schema";

/**
 * Data access for accounts and their role grants. The only module that reads
 * users.password_hash — callers get it back from findAccountByUsername alone,
 * and it never appears in a User object or any API response.
 */
export interface SessionUserRecord extends User {
  sessionVersion: number;
}

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  passwordHash: string;
  sessionVersion: number;
}

async function loadGrants(roleName: string): Promise<Pick<User, "permissions" | "editPermissions">> {
  const db = getDb();
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${roleName})`)
    .limit(1);
  if (!role) return { permissions: [], editPermissions: [] };

  const grants = await db
    .select({ key: rolePermissions.permission_key, canEdit: rolePermissions.can_edit })
    .from(rolePermissions)
    .where(eq(rolePermissions.role_id, role.id));
  return {
    permissions: grants.map((grant) => grant.key),
    editPermissions: grants.filter((grant) => grant.canEdit).map((grant) => grant.key),
  };
}

export async function findSessionUser(userId: string): Promise<SessionUserRecord | null> {
  const [record] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.username,
      role: users.role,
      department: users.department,
      sessionVersion: users.session_version,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!record) return null;
  return { ...record, ...(await loadGrants(record.role)) };
}

export async function findAccountByUsername(username: string): Promise<AccountRecord | null> {
  const [account] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.username,
      role: users.role,
      department: users.department,
      passwordHash: users.password_hash,
      sessionVersion: users.session_version,
    })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return account ?? null;
}

export async function toUser(account: AccountRecord): Promise<User> {
  const { id, name, email, role, department } = account;
  return { id, name, email, role, department, ...(await loadGrants(role)) };
}

/** Revokes every outstanding session token for the user (see lib/session-token.ts). */
export async function incrementSessionVersion(userId: string): Promise<void> {
  await getDb()
    .update(users)
    .set({ session_version: sql`${users.session_version} + 1` })
    .where(eq(users.id, userId));
}
