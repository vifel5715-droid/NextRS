"use server";

import { and, eq, sql } from "drizzle-orm";
import type { OptionListEntry, RolePermissionGrant, RoleWithPermissions } from "@shared/types";
import { isPermissionKey } from "../../core/security/permissionKeys";
import { runAction, type ActionResult } from "../action-result";
import { assertId, requirePermission, requireRole, requireUser, type AuthorizedUser } from "../access";
import { getDb } from "../db";
import {
  deletionLog,
  itemRequestItems,
  itemRequests,
  optionLists,
  rolePermissions,
  roles,
  serviceItems,
  serviceRequests,
  users,
} from "../db/schema";
import { publishRequestChanged } from "../realtime";

type OptionKind = OptionListEntry["kind"];
const OPTION_KINDS: readonly OptionKind[] = ["item_type", "uom", "machine_code", "item_group", "department"];

/** Ported from the legacy option-list controller's assertCanWriteKind. */
function assertCanWriteKind(kind: OptionKind, user: AuthorizedUser): void {
  if (user.roleKey === "director") throw new Error("Permission denied.");
  if (kind === "department") {
    if (user.roleKey !== "admin") throw new Error("Only Admin can manage the department list.");
    return;
  }
  if (kind !== "machine_code" && !["custodian", "admin"].includes(user.roleKey)) {
    throw new Error("Only Custodian or Admin can manage this option list.");
  }
}

function parseOptionValue(value: unknown, description: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new Error("Value is required and must be at most 100 characters.");
  }
  if (description !== undefined && description !== null && (typeof description !== "string" || description.trim().length > 255)) {
    throw new Error("Description must be at most 255 characters.");
  }
  return {
    value: value.trim().toUpperCase(),
    description: typeof description === "string" ? description.trim() || null : undefined,
  };
}

const toOptionEntry = (row: typeof optionLists.$inferSelect): OptionListEntry => ({
  id: row.id,
  kind: row.kind as OptionKind,
  value: row.value,
  description: row.description,
  created_at: row.created_at,
});

/** Idempotent: an existing case-insensitive match is returned as-is. */
export async function createOptionListEntryAction(
  kind: OptionKind,
  value: string,
  description?: string
): Promise<ActionResult<OptionListEntry>> {
  return runAction(async () => {
    const user = await requireUser();
    if (!OPTION_KINDS.includes(kind)) throw new Error("Invalid option list kind.");
    assertCanWriteKind(kind, user);
    const parsed = parseOptionValue(value, description);
    const db = getDb();
    const [existing] = await db
      .select()
      .from(optionLists)
      .where(and(eq(optionLists.kind, kind), sql`upper(${optionLists.value}) = ${parsed.value}`))
      .limit(1);
    if (existing) return toOptionEntry(existing);
    const [created] = await db
      .insert(optionLists)
      .values({
        kind,
        value: parsed.value,
        description: parsed.description ?? null,
        created_by: user.id,
        created_at: new Date().toISOString(),
      })
      .returning();
    await publishRequestChanged({ type: "catalog", action: "created", id: created.id, department: null });
    return toOptionEntry(created);
  });
}

export async function updateOptionListEntryAction(
  id: number,
  value: string,
  description?: string
): Promise<ActionResult<OptionListEntry>> {
  return runAction(async () => {
    const user = await requireUser();
    assertId(id, "option ID");
    const parsed = parseOptionValue(value, description);
    const db = getDb();
    const [existing] = await db.select().from(optionLists).where(eq(optionLists.id, id)).limit(1);
    if (!existing) throw new Error("Option not found.");
    assertCanWriteKind(existing.kind as OptionKind, user);
    const [duplicate] = await db
      .select({ id: optionLists.id })
      .from(optionLists)
      .where(and(eq(optionLists.kind, existing.kind), sql`upper(${optionLists.value}) = ${parsed.value}`, sql`${optionLists.id} <> ${id}`))
      .limit(1);
    if (duplicate) throw new Error(`"${parsed.value}" already exists in this list.`);
    const [updated] = await db
      .update(optionLists)
      .set({ value: parsed.value, ...(parsed.description !== undefined ? { description: parsed.description } : {}) })
      .where(eq(optionLists.id, id))
      .returning();
    await publishRequestChanged({ type: "catalog", action: "updated", id, department: null });
    return toOptionEntry(updated);
  });
}

export async function deleteOptionListEntryAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    assertId(id, "option ID");
    const db = getDb();
    const [existing] = await db.select().from(optionLists).where(eq(optionLists.id, id)).limit(1);
    if (!existing) throw new Error("Option not found.");
    assertCanWriteKind(existing.kind as OptionKind, user);
    await db.delete(optionLists).where(eq(optionLists.id, id));
    await publishRequestChanged({ type: "catalog", action: "deleted", id, department: null });
  });
}

// ---------------------------------------------------------------------------
// Roles (admin only — role management is never itself permission-gated).
// ---------------------------------------------------------------------------

function parseGrants(value: unknown): RolePermissionGrant[] {
  if (!Array.isArray(value)) throw new Error("Invalid permission list.");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Invalid permission.");
    const grant = entry as Record<string, unknown>;
    if (typeof grant.key !== "string" || !isPermissionKey(grant.key)) throw new Error(`Unknown permission "${String(grant.key)}".`);
    if (seen.has(grant.key)) throw new Error(`Permission "${grant.key}" is listed twice.`);
    seen.add(grant.key);
    return { key: grant.key, can_edit: grant.can_edit === true };
  });
}

function parseLabel(label: unknown): string {
  if (typeof label !== "string" || !label.trim() || label.trim().length > 100) {
    throw new Error("Label is required and must be at most 100 characters.");
  }
  return label.trim();
}

export async function createRoleAction(input: {
  name: string;
  label: string;
  permissions: RolePermissionGrant[];
}): Promise<ActionResult<RoleWithPermissions>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["admin"]);
    const name = typeof input?.name === "string" ? input.name.trim().toLowerCase() : "";
    if (!name || name.length > 50) throw new Error("Role name is required and must be at most 50 characters.");
    const label = parseLabel(input.label);
    const permissions = parseGrants(input.permissions);
    const now = new Date().toISOString();
    return getDb().transaction(async (tx) => {
      const [existing] = await tx.select({ id: roles.id }).from(roles).where(sql`lower(${roles.name}) = ${name}`).limit(1);
      if (existing) throw new Error(`A role named "${name}" already exists.`);
      const [role] = await tx.insert(roles).values({ name, label, is_system: false, created_at: now }).returning();
      if (permissions.length > 0) {
        await tx.insert(rolePermissions).values(
          permissions.map((grant) => ({ role_id: role.id, permission_key: grant.key, can_edit: grant.can_edit, created_at: now }))
        );
      }
      return { ...role, permissions };
    });
  });
}

export async function updateRoleAction(
  id: number,
  input: { label: string; permissions: RolePermissionGrant[] }
): Promise<ActionResult<RoleWithPermissions>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["admin"]);
    assertId(id, "role ID");
    const label = parseLabel(input?.label);
    const permissions = parseGrants(input?.permissions);
    const now = new Date().toISOString();
    return getDb().transaction(async (tx) => {
      const [role] = await tx.update(roles).set({ label }).where(eq(roles.id, id)).returning();
      if (!role) throw new Error("Role not found.");
      await tx.delete(rolePermissions).where(eq(rolePermissions.role_id, id));
      if (permissions.length > 0) {
        await tx.insert(rolePermissions).values(
          permissions.map((grant) => ({ role_id: id, permission_key: grant.key, can_edit: grant.can_edit, created_at: now }))
        );
      }
      return { ...role, permissions };
    });
  });
}

export async function deleteRoleAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["admin"]);
    assertId(id, "role ID");
    const db = getDb();
    const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw new Error("Role not found.");
    if (role.is_system) throw new Error("Built-in roles cannot be deleted.");
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`lower(${users.role}) = lower(${role.name})`);
    if (Number(count) > 0) {
      throw new Error(`${count} user${Number(count) === 1 ? " still has" : "s still have"} this role assigned.`);
    }
    await db.delete(roles).where(eq(roles.id, id));
  });
}

// ---------------------------------------------------------------------------
// Deleted items: basic re-add of a deleted line (name/qty/uom only).
// ---------------------------------------------------------------------------

export async function recoverDeletionLogEntryAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["deleted_items"]);
    requireRole(user, ["custodian", "admin"]);
    assertId(id, "deletion record ID");

    const recovered = await getDb().transaction(async (tx) => {
      const [entry] = await tx.select().from(deletionLog).where(eq(deletionLog.id, id)).for("update");
      if (!entry) throw new Error("Deletion record not found.");
      if (entry.recovered_at) throw new Error("This item has already been recovered.");
      if (entry.request_type === "audit") throw new Error("Issuance records can't be recovered here — re-issue the item instead.");
      if (entry.request_type === "rr") throw new Error("A cleared Receiving Report No. can't be recovered here — re-enter it on the service instead.");
      if (entry.request_id === null) throw new Error("Cannot recover — the original request is unknown.");

      let department: string;
      if (entry.request_type === "item") {
        const [parent] = await tx
          .select({ department: itemRequests.department })
          .from(itemRequests)
          .where(eq(itemRequests.id, entry.request_id))
          .limit(1);
        if (!parent) throw new Error("Cannot recover — the original request no longer exists.");
        department = parent.department;
        const quantity = entry.quantity ?? 1;
        await tx.insert(itemRequestItems).values({
          request_id: entry.request_id,
          item_name: entry.entity_name,
          quantity,
          uom: entry.uom ?? "",
          qty_balance: quantity,
        });
      } else {
        const [parent] = await tx
          .select({ department: serviceRequests.department })
          .from(serviceRequests)
          .where(eq(serviceRequests.id, entry.request_id))
          .limit(1);
        if (!parent) throw new Error("Cannot recover — the original request no longer exists.");
        department = parent.department;
        await tx.insert(serviceItems).values({ service_request_id: entry.request_id, description: entry.entity_name });
      }
      await tx
        .update(deletionLog)
        .set({ recovered_at: new Date().toISOString(), recovered_by: user.id })
        .where(eq(deletionLog.id, id));
      return { type: entry.request_type === "item" ? ("item" as const) : ("service" as const), id: entry.request_id, department };
    });
    await publishRequestChanged({ action: "updated", ...recovered });
  });
}
