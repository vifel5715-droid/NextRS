/**
 * ARCH: Resolves a role's granted page-permission keys (db/schema.ts's
 * roles/rolePermissions) at request time. Kept separate from
 * requestAccess.ts, which answers a different question (which department's
 * data a role can see, not which pages it can reach).
 *
 * Plain per-request query, no caching — role/permission edits are rare
 * admin actions, and every other role-adjacent lookup in this codebase
 * (resolveUserDepartment's fallback query) already accepts a DB round-trip
 * in comparable spots. Revisit only if this turns out to be a hot path.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../../database/db.js";
import { roles, rolePermissions } from "../../database/schema.js";
import { PERMISSION_KEYS } from "./permissionKeys.js";

export interface RolePermissionSets {
  /** Pages this role can see at all. */
  view: Set<string>;
  /** Pages this role can also use the write/edit actions on — a subset of `view`. */
  edit: Set<string>;
}

export async function getRolePermissions(role: string): Promise<RolePermissionSets> {
  // Admin can view and update every transaction regardless of the Roles
  // screen's checkboxes — so every editPermissionMiddleware route and every
  // in-service edit check (e.g. a submitted Payment Request Form) lets admin
  // through, and the login payload shows admin every page.
  if (role.toLowerCase() === "admin") {
    return { view: new Set(PERMISSION_KEYS), edit: new Set(PERMISSION_KEYS) };
  }
  const rows = await db
    .select({ key: rolePermissions.permission_key, canEdit: rolePermissions.can_edit })
    .from(roles)
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.role_id))
    .where(sql`lower(${roles.name}) = ${role.toLowerCase()}`);
  return {
    view: new Set(rows.map((r) => r.key)),
    edit: new Set(rows.filter((r) => r.canEdit).map((r) => r.key)),
  };
}
