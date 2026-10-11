"use server";

import { and, eq, sql } from "drizzle-orm";
import { hashPassword } from "@shared/utils/password";
import type { UserRecord } from "@shared/types";
import { runAction, type ActionResult } from "../action-result";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { roles, users } from "../db/schema";

export interface SaveAdminUserInput {
  id?: string;
  name: string;
  email: string;
  role: string;
  department: string;
  password?: string;
}

async function requireUsersManagementPermission(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("users_management")) {
    throw new Error("Permission denied.");
  }
}

export async function saveAdminUserAction(input: SaveAdminUserInput): Promise<ActionResult<UserRecord>> {
  return runAction(() => saveAdminUser(input));
}

async function saveAdminUser(input: SaveAdminUserInput): Promise<UserRecord> {
  await requireUsersManagementPermission();

  if (!input || typeof input !== "object") throw new Error("Invalid user details.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const roleName = typeof input.role === "string" ? input.role.trim() : "";
  const department = typeof input.department === "string" ? input.department.trim().toUpperCase() : "";
  const password = input.password;

  if (!name || name.length > 200) throw new Error("Name is required and must be at most 200 characters.");
  if (!email || email.length > 254) throw new Error("Username is required and must be at most 254 characters.");
  if (!roleName || roleName.length > 100) throw new Error("A valid role is required.");
  if (!department || department.length > 100) throw new Error("A valid department is required.");
  if (password !== undefined && (typeof password !== "string" || password.length > 1024)) {
    throw new Error("Password must be at most 1024 characters.");
  }
  if (!input.id && (!password || password.length === 0)) {
    throw new Error("Password is required for a new user.");
  }
  if (input.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) {
    throw new Error("Invalid user ID.");
  }

  const db = getDb();
  const [role] = await db
    .select({ name: roles.name })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${roleName})`)
    .limit(1);
  if (!role) throw new Error("Selected role does not exist.");

  const [duplicate] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = lower(${email})`,
        input.id ? sql`${users.id} <> ${input.id}` : undefined
      )
    )
    .limit(1);
  if (duplicate) throw new Error("Username is already in use.");

  if (input.id) {
    const values = {
      name,
      username: email,
      role: role.name,
      department,
      ...(password ? { password_hash: await hashPassword(password) } : {}),
    };
    const [updated] = await db
      .update(users)
      .set(values)
      .where(eq(users.id, input.id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.username,
        role: users.role,
        department: users.department,
      });
    if (!updated) throw new Error("User not found.");
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values({
      name,
      username: email,
      password_hash: await hashPassword(password!),
      role: role.name,
      department,
      created_at: new Date().toISOString(),
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.username,
      role: users.role,
      department: users.department,
    });

  return created;
}
