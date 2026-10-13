"use server";

import { inArray } from "drizzle-orm";
import type { RoleWithPermissions, UserRecord } from "@/types";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { rolePermissions, roles, users } from "@/db/schema";

async function requireUsersManagementPermission(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("users_management")) {
    throw new Error("Permission denied.");
  }
}

export async function getAdminUsersAction(): Promise<UserRecord[]> {
  await requireUsersManagementPermission();

  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.username,
      role: users.role,
      department: users.department,
    })
    .from(users);

  return rows;
}

export async function getAdminRolesAction(): Promise<RoleWithPermissions[]> {
  await requireUsersManagementPermission();

  const db = getDb();
  const roleRows = await db.select().from(roles);
  const roleIds = roleRows.map((role) => role.id);
  const permissionRows = roleIds.length
    ? await db
        .select({
          role_id: rolePermissions.role_id,
          key: rolePermissions.permission_key,
          can_edit: rolePermissions.can_edit,
        })
        .from(rolePermissions)
        .where(inArray(rolePermissions.role_id, roleIds))
    : [];
  const permissionsByRole = new Map<number, RoleWithPermissions["permissions"]>();

  for (const permission of permissionRows) {
    const grants = permissionsByRole.get(permission.role_id) ?? [];
    grants.push({ key: permission.key, can_edit: permission.can_edit });
    permissionsByRole.set(permission.role_id, grants);
  }

  return roleRows.map((role) => ({
    ...role,
    permissions: permissionsByRole.get(role.id) ?? [],
  }));
}
