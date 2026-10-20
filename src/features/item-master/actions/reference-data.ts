"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { ApprovalLevel, ItemCatalogEntry, OptionListEntry, User } from "@/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { publishRequestChanged } from "@/lib/realtime";
import { getDb } from "@/lib/db";
import { itemCatalog, itemRequestItems, itemRequests, optionLists } from "@/db/schema";
import { logAdjustments } from "@/server/audit/adjustments";
import { loadCatalogUoms } from "@/server/services/catalog-uom";

export type OptionListKind = OptionListEntry["kind"];

export interface SaveItemCatalogInput {
  item_name: string;
  uom: string;
  machine_code?: string;
  item_group?: string;
  approval_level: ApprovalLevel;
  departments?: string[];
}

const OPTION_LIST_KINDS: readonly OptionListKind[] = [
  "item_type",
  "uom",
  "machine_code",
  "item_group",
  "department",
];

function isOptionListKind(value: string): value is OptionListKind {
  return OPTION_LIST_KINDS.some((kind) => kind === value);
}

async function requireAuthenticatedUser(): Promise<void> {
  if (!(await getCurrentUser())) {
    throw new Error("Authentication required.");
  }
}

async function requireItemCatalogManagementPermission() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("item_list")) throw new Error("Permission denied.");
  if (!["admin", "custodian"].includes(user.role.trim().toLowerCase())) {
    throw new Error("Permission denied.");
  }
  return user;
}

function validateItemCatalogInput(input: SaveItemCatalogInput) {
  if (!input || typeof input !== "object") throw new Error("Invalid item details.");
  const item_name = typeof input.item_name === "string" ? input.item_name.trim().toUpperCase() : "";
  const uom = typeof input.uom === "string" ? input.uom.trim() : "";
  const machine_code = typeof input.machine_code === "string" ? input.machine_code.trim() : "";
  const item_group = typeof input.item_group === "string" ? input.item_group.trim() : "";
  if (!item_name || item_name.length > 500) throw new Error("Item Name is required and must be at most 500 characters.");
  if (!uom || uom.length > 100) throw new Error("UoM is required and must be at most 100 characters.");
  if (machine_code.length > 200) throw new Error("Machine Code must be at most 200 characters.");
  if (item_group.length > 200) throw new Error("Item Group must be at most 200 characters.");
  if (input.approval_level !== "MANAGER_ONLY" && input.approval_level !== "SUPERVISOR_OR_MANAGER") {
    throw new Error("A valid approver level is required.");
  }
  if (input.departments !== undefined && (!Array.isArray(input.departments) || input.departments.some((value) => typeof value !== "string"))) {
    throw new Error("Departments must be a list of valid department names.");
  }

  return {
    item_name,
    uom,
    machine_code: machine_code || null,
    item_group: item_group || null,
    approval_level: input.approval_level,
    departments: input.departments?.map((department) => department.trim()).filter(Boolean).join(",") || null,
  };
}

function toItemCatalogEntry(row: typeof itemCatalog.$inferSelect): ItemCatalogEntry {
  if (row.approval_level !== "MANAGER_ONLY" && row.approval_level !== "SUPERVISOR_OR_MANAGER") {
    throw new Error(`Unexpected item catalog approval level in database: ${row.approval_level}`);
  }
  return {
    id: row.id,
    item_name: row.item_name,
    item_type: row.item_type,
    uom: row.uom,
    machine_code: row.machine_code,
    item_group: row.item_group,
    approval_level: row.approval_level,
    departments: row.departments,
    created_at: row.created_at,
  };
}

function toOptionListEntry(row: {
  id: number;
  kind: string;
  value: string;
  description: string | null;
  created_at: string;
}): OptionListEntry {
  if (!isOptionListKind(row.kind)) {
    throw new Error(`Unexpected option list kind in database: ${row.kind}`);
  }
  return { ...row, kind: row.kind };
}

export async function getOptionListAction(kind: OptionListKind): Promise<OptionListEntry[]> {
  if (!isOptionListKind(kind)) {
    throw new Error("Invalid option list kind.");
  }

  await requireAuthenticatedUser();
  const rows = await getDb()
    .select({
      id: optionLists.id,
      kind: optionLists.kind,
      value: optionLists.value,
      description: optionLists.description,
      created_at: optionLists.created_at,
    })
    .from(optionLists)
    .where(eq(optionLists.kind, kind));

  return rows.map(toOptionListEntry);
}

export async function getItemCatalogAction(): Promise<ItemCatalogEntry[]> {
  await requireAuthenticatedUser();
  const rows = await getDb().select().from(itemCatalog);

  return rows.map(toItemCatalogEntry);
}

export async function createItemCatalogEntryAction(input: SaveItemCatalogInput): Promise<ActionResult<ItemCatalogEntry>> {
  return runAction(() => createItemCatalogEntry(input));
}

async function createItemCatalogEntry(input: SaveItemCatalogInput): Promise<ItemCatalogEntry> {
  const user = await requireItemCatalogManagementPermission();
  const values = validateItemCatalogInput(input);
  const [row] = await getDb()
    .insert(itemCatalog)
    .values({ ...values, created_by: user.id, created_at: new Date().toISOString() })
    .returning();
  if (!row) throw new Error("Failed to add item to the catalog.");
  await publishRequestChanged({ type: "catalog", action: "created", id: row.id, department: null });
  await syncPendingRequestItemsToCatalog(user, row);
  return toItemCatalogEntry(row);
}

/**
 * Brings IRS lines requested under this catalog name (case-insensitive) in
 * line with the catalog entry: name, UoM and, when the catalog has one,
 * machine code. Only lines with no delivery status yet — once an item is in
 * PR/OUT/DELIVERED/etc. its UoM is part of what was bought or issued and must
 * not shift underneath it. The UoM follows the same department/duplicate
 * rules as saving a request (see loadCatalogUoms).
 */
async function syncPendingRequestItemsToCatalog(user: User, entry: typeof itemCatalog.$inferSelect) {
  const db = getDb();
  const matches = await db
    .select({ item: itemRequestItems, serial: itemRequests.serial, department: itemRequests.department })
    .from(itemRequestItems)
    .innerJoin(itemRequests, eq(itemRequests.id, itemRequestItems.request_id))
    .where(
      and(
        eq(sql`upper(trim(${itemRequestItems.item_name}))`, entry.item_name.trim().toUpperCase()),
        isNull(itemRequestItems.delivery_status)
      )
    );

  const changedRequests = new Map<number, string>();
  await db.transaction(async (tx) => {
    for (const { item, serial, department } of matches) {
      const catalogUom = await loadCatalogUoms(tx, department, [item.item_name]);
      const next = {
        item_name: entry.item_name,
        uom: catalogUom(item.item_name) ?? item.uom,
        machine_code: entry.machine_code ?? item.machine_code,
      };
      if (next.item_name === item.item_name && next.uom === item.uom && next.machine_code === item.machine_code) continue;
      await tx.update(itemRequestItems).set(next).where(eq(itemRequestItems.id, item.id));
      await logAdjustments(tx, {
        user: { ...user, roleKey: user.role.trim().toLowerCase() },
        requestId: item.request_id,
        requestType: "item",
        requestSerial: serial,
        department,
        itemLabel: entry.item_name,
        remarks: "Updated from Item List",
        changes: [
          ["Item Name", item.item_name, next.item_name],
          ["UoM", item.uom, next.uom],
          ["Machine Code", item.machine_code ?? "", next.machine_code ?? ""],
        ],
      });
      changedRequests.set(item.request_id, department);
    }
  });

  for (const [id, department] of changedRequests) {
    await publishRequestChanged({ type: "item", action: "updated", id, department });
  }
}

export async function updateItemCatalogEntryAction(id: number, input: SaveItemCatalogInput): Promise<ActionResult<ItemCatalogEntry>> {
  return runAction(() => updateItemCatalogEntry(id, input));
}

async function updateItemCatalogEntry(id: number, input: SaveItemCatalogInput): Promise<ItemCatalogEntry> {
  const user = await requireItemCatalogManagementPermission();
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid item ID.");
  const values = validateItemCatalogInput(input);
  const [row] = await getDb()
    .update(itemCatalog)
    .set(values)
    .where(eq(itemCatalog.id, id))
    .returning();
  if (!row) throw new Error("Item not found.");
  await publishRequestChanged({ type: "catalog", action: "updated", id, department: null });
  await syncPendingRequestItemsToCatalog(user, row);
  return toItemCatalogEntry(row);
}

export async function deleteItemCatalogEntryAction(id: number): Promise<ActionResult<void>> {
  return runAction(() => deleteItemCatalogEntry(id));
}

async function deleteItemCatalogEntry(id: number): Promise<void> {
  await requireItemCatalogManagementPermission();
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid item ID.");
  const [deleted] = await getDb()
    .delete(itemCatalog)
    .where(eq(itemCatalog.id, id))
    .returning({ id: itemCatalog.id });
  if (!deleted) throw new Error("Item not found.");
  await publishRequestChanged({ type: "catalog", action: "deleted", id, department: null });
}
