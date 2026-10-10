"use server";

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { AdjustmentLogEntry, DeletionLogEntry, OutedItem } from "@services/api";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import {
  adjustmentLog,
  deletionLog,
  itemIssuanceAudits,
  itemRequestItems,
  itemRequests,
  users,
} from "../db/schema";

const GLOBAL_HISTORY_ROLES = new Set(["admin", "custodian", "director"]);

async function requirePermission(permission: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes(permission)) throw new Error("Permission denied.");
  return user;
}

export async function getOutedItemsAction(): Promise<OutedItem[]> {
  await requirePermission("item_list");

  const db = getDb();
  const rows = await db
    .select({
      request_id: itemRequests.id,
      serial: itemRequests.serial,
      purpose: itemRequests.purpose,
      status: itemRequests.status,
      supervisor_status: itemRequests.supervisor_status,
      custodian_status: itemRequests.custodian_status,
      item_id: itemRequestItems.id,
      item_name: itemRequestItems.item_name,
      issuance_number: itemRequestItems.issuance_number,
      quantity: itemRequestItems.quantity,
      quantity_out: itemRequestItems.quantity_out,
      machine_code: itemRequestItems.machine_code,
    })
    .from(itemRequests)
    .innerJoin(itemRequestItems, eq(itemRequestItems.request_id, itemRequests.id))
    .where(gt(itemRequestItems.quantity_out, 0))
    .orderBy(desc(itemRequests.created_at));

  const itemIds = rows.map((row) => row.item_id);
  const audits = itemIds.length
    ? await db
        .select({
          item_id: itemIssuanceAudits.item_request_item_id,
          issued_at: itemIssuanceAudits.issued_at,
        })
        .from(itemIssuanceAudits)
        .where(
          and(
            inArray(itemIssuanceAudits.item_request_item_id, itemIds),
            eq(itemIssuanceAudits.transaction_type, "OUT")
          )
        )
        .orderBy(desc(itemIssuanceAudits.issued_at))
    : [];

  const latestIssuedAt = new Map<number, string>();
  for (const audit of audits) {
    if (!latestIssuedAt.has(audit.item_id)) latestIssuedAt.set(audit.item_id, audit.issued_at);
  }

  const requests = new Map<number, OutedItem>();
  for (const row of rows) {
    let request = requests.get(row.request_id);
    if (!request) {
      request = {
        id: row.request_id,
        serial: row.serial,
        purpose: row.purpose,
        status: row.status,
        supervisor_status: row.supervisor_status,
        custodian_status: row.custodian_status,
        items: [],
      };
      requests.set(row.request_id, request);
    }
    request.items.push({
      item_name: row.item_name,
      issuance_number: row.issuance_number,
      quantity: row.quantity,
      quantity_out: row.quantity_out,
      machine_code: row.machine_code,
      issued_at: latestIssuedAt.get(row.item_id) ?? null,
    });
  }

  return [...requests.values()];
}

export async function getAdjustmentLogAction(): Promise<AdjustmentLogEntry[]> {
  const user = await requirePermission("adjustment_history");
  const db = getDb();
  const scope = GLOBAL_HISTORY_ROLES.has(user.role.toLowerCase())
    ? undefined
    : eq(adjustmentLog.department, user.department);

  return db
    .select({
      id: adjustmentLog.id,
      adjustment_serial: adjustmentLog.adjustment_serial,
      request_id: adjustmentLog.request_id,
      request_serial: adjustmentLog.request_serial,
      department: adjustmentLog.department,
      item_label: adjustmentLog.item_label,
      field: adjustmentLog.field,
      before_value: adjustmentLog.before_value,
      after_value: adjustmentLog.after_value,
      adjustment_remarks: adjustmentLog.adjustment_remarks,
      adjusted_by: adjustmentLog.adjusted_by,
      adjusted_by_name: adjustmentLog.adjusted_by_name,
      adjusted_by_role: adjustmentLog.adjusted_by_role,
      adjusted_by_department: adjustmentLog.adjusted_by_department,
      adjusted_at: adjustmentLog.adjusted_at,
    })
    .from(adjustmentLog)
    .where(scope)
    .orderBy(desc(adjustmentLog.adjusted_at));
}

export async function getAdjustmentLogForRequestAction(
  requestId: number,
  requestType: "item" | "service" | "petty_cash"
): Promise<AdjustmentLogEntry[]> {
  if (!Number.isSafeInteger(requestId) || requestId < 1) {
    throw new Error("Invalid request ID.");
  }

  const user = await requirePermission("adjustment_history");
  const db = getDb();
  const scope = GLOBAL_HISTORY_ROLES.has(user.role.toLowerCase())
    ? undefined
    : eq(adjustmentLog.department, user.department);

  return db
    .select({
      id: adjustmentLog.id,
      adjustment_serial: adjustmentLog.adjustment_serial,
      request_id: adjustmentLog.request_id,
      request_serial: adjustmentLog.request_serial,
      department: adjustmentLog.department,
      item_label: adjustmentLog.item_label,
      field: adjustmentLog.field,
      before_value: adjustmentLog.before_value,
      after_value: adjustmentLog.after_value,
      adjustment_remarks: adjustmentLog.adjustment_remarks,
      adjusted_by: adjustmentLog.adjusted_by,
      adjusted_by_name: adjustmentLog.adjusted_by_name,
      adjusted_by_role: adjustmentLog.adjusted_by_role,
      adjusted_by_department: adjustmentLog.adjusted_by_department,
      adjusted_at: adjustmentLog.adjusted_at,
    })
    .from(adjustmentLog)
    .where(
      and(
        eq(adjustmentLog.request_id, requestId),
        eq(adjustmentLog.request_type, requestType),
        scope
      )
    )
    .orderBy(desc(adjustmentLog.adjusted_at));
}

export async function getDeletionLogAction(): Promise<DeletionLogEntry[]> {
  const user = await requirePermission("deleted_items");
  const db = getDb();
  const scope = GLOBAL_HISTORY_ROLES.has(user.role.toLowerCase())
    ? undefined
    : eq(deletionLog.department, user.department);
  const entries = await db
    .select({
      id: deletionLog.id,
      request_type: deletionLog.request_type,
      request_id: deletionLog.request_id,
      request_serial: deletionLog.request_serial,
      department: deletionLog.department,
      entity_name: deletionLog.entity_name,
      quantity: deletionLog.quantity,
      uom: deletionLog.uom,
      issued_by_name: deletionLog.issued_by_name,
      reason: deletionLog.reason,
      deleted_by: deletionLog.deleted_by,
      deleted_at: deletionLog.deleted_at,
      recovered_at: deletionLog.recovered_at,
    })
    .from(deletionLog)
    .where(scope)
    .orderBy(desc(deletionLog.deleted_at));

  const deleterIds = [...new Set(entries.map((entry) => entry.deleted_by))];
  const deleters = deleterIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, deleterIds))
    : [];
  const deleterNames = new Map(deleters.map((deleter) => [deleter.id, deleter.name]));

  return entries.map((entry) => {
    if (
      entry.request_type !== "item" &&
      entry.request_type !== "service" &&
      entry.request_type !== "audit" &&
      entry.request_type !== "rr"
    ) {
      throw new Error(`Unexpected deletion log request type: ${entry.request_type}`);
    }

    return {
      id: entry.id,
      request_type: entry.request_type,
      request_id: entry.request_id,
      request_serial: entry.request_serial,
      department: entry.department,
      entity_name: entry.entity_name,
      quantity: entry.quantity,
      uom: entry.uom,
      issued_by_name: entry.issued_by_name,
      reason: entry.reason,
      deleted_by_name: deleterNames.get(entry.deleted_by) ?? null,
      deleted_at: entry.deleted_at,
      recovered_at: entry.recovered_at,
    };
  });
}
