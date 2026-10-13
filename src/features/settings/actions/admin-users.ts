"use server";

import { and, eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import type { UserRecord } from "@/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser, type AuthorizedUser } from "@/lib/auth";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { roles, users } from "@/db/schema";
import { recordAudit } from "@/server/audit/audit-log";

export interface SaveAdminUserInput {
  id?: string;
  name: string;
  email: string;
  role: string;
  department: string;
  password?: string;
}

const MIN_PASSWORD_LENGTH = 8;
const ADMIN_ROLE = "admin";

async function requireUsersManager(): Promise<AuthorizedUser> {
  const user = await requireUser();
  requirePermission(user, ["users_management"]);
  return user;
}

/**
 * users_management can be granted to custom roles, but role management itself
 * is admin-only (see db/seed-roles.ts) so that permission can't be used to
 * escalate. The same must hold here: only an admin may give someone the
 * admin role or change an existing admin account (e.g. reset its password).
 */
function assertMayManageRole(actor: AuthorizedUser, roleName: string): void {
  if (actor.roleKey !== ADMIN_ROLE && roleName.trim().toLowerCase() === ADMIN_ROLE) {
    throw new ForbiddenError("Only an administrator can manage administrator accounts.");
  }
}

interface ParsedUserInput {
  name: string;
  email: string;
  roleName: string;
  department: string;
  password: string | undefined;
}

function parseUserInput(input: SaveAdminUserInput): ParsedUserInput {
  if (!input || typeof input !== "object") throw new ValidationError("Invalid user details.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const roleName = typeof input.role === "string" ? input.role.trim() : "";
  const department = typeof input.department === "string" ? input.department.trim().toUpperCase() : "";
  const password = input.password;

  if (!name || name.length > 200) throw new ValidationError("Name is required and must be at most 200 characters.");
  if (!email || email.length > 254) throw new ValidationError("Username is required and must be at most 254 characters.");
  if (!roleName || roleName.length > 100) throw new ValidationError("A valid role is required.");
  if (!department || department.length > 100) throw new ValidationError("A valid department is required.");
  if (password !== undefined && (typeof password !== "string" || password.length > 1024)) {
    throw new ValidationError("Password must be at most 1024 characters.");
  }
  if (!input.id && !password) {
    throw new ValidationError("Password is required for a new user.");
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (input.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) {
    throw new ValidationError("Invalid user ID.");
  }
  return { name, email, roleName, department, password };
}

export async function saveAdminUserAction(input: SaveAdminUserInput): Promise<ActionResult<UserRecord>> {
  return runAction(() => saveAdminUser(input));
}

async function saveAdminUser(input: SaveAdminUserInput): Promise<UserRecord> {
  const actor = await requireUsersManager();

  const { name, email, roleName, department, password } = parseUserInput(input);

  const db = getDb();
  const [role] = await db
    .select({ name: roles.name })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${roleName})`)
    .limit(1);
  if (!role) throw new ValidationError("Selected role does not exist.");
  assertMayManageRole(actor, role.name);

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
  if (duplicate) throw new ValidationError("Username is already in use.");

  const passwordHash = password ? await hashPassword(password) : undefined;
  const returning = {
    id: users.id,
    name: users.name,
    email: users.username,
    role: users.role,
    department: users.department,
  };
  const actorRef = { id: actor.id, name: actor.name };

  if (input.id) {
    const userId = input.id;
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!existing) throw new NotFoundError("User not found.");
      assertMayManageRole(actor, existing.role);

      const [updated] = await tx
        .update(users)
        .set({
          name,
          username: email,
          role: role.name,
          department,
          // A new password revokes every session the user already has.
          ...(passwordHash
            ? { password_hash: passwordHash, session_version: sql`${users.session_version} + 1` }
            : {}),
        })
        .where(eq(users.id, userId))
        .returning(returning);

      await recordAudit(tx, {
        action: "user.updated",
        actor: actorRef,
        entityType: "user",
        entityId: userId,
        department,
        details: { username: email, previousRole: existing.role, role: role.name, passwordChanged: Boolean(passwordHash) },
      });
      return updated;
    });
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        name,
        username: email,
        password_hash: passwordHash!,
        role: role.name,
        department,
        created_at: new Date().toISOString(),
      })
      .returning(returning);

    await recordAudit(tx, {
      action: "user.created",
      actor: actorRef,
      entityType: "user",
      entityId: created.id,
      department,
      details: { username: email, role: role.name },
    });
    return created;
  });
}
