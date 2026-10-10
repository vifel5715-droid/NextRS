"use server";

import { eq, like, sql } from "drizzle-orm";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import {
  adjustmentLog,
  itemIssuanceAudits,
  itemRequestItems,
  itemRequests,
} from "../db/schema";

interface ItemUpdateValues {
  item_name: string;
  quantity: number;
  uom: string;
  remarks: string | null;
  machine_code: string | null;
  issuance_number: string | null;
  pr_number: string | null;
  date_needed: string | null;
  delivery_status: string | null;
  pr_status: string | null;
  quantity_delivered?: number;
  quantity_out?: number;
  adjustment_remarks?: string;
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid item details.");
  }
  return value as Record<string, unknown>;
}

function requiredText(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${key.replaceAll("_", " ")} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(input: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new Error(`${key.replaceAll("_", " ")} must be at most ${maxLength} characters.`);
  }
  return value.trim() || null;
}

function optionalQuantity(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${key.replaceAll("_", " ")} must be a non-negative whole number.`);
  }
  return value;
}

function parseInput(value: unknown): ItemUpdateValues {
  const input = asRecord(value);
  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const deliveryStatus = optionalText(input, "delivery_status", 50);
  const prStatus = optionalText(input, "pr_status", 50);
  const allowedDeliveryStatuses = new Set([
    "OUT",
    "PURCHASE REQUEST",
    "URGENT",
    "HOLD",
    "DELIVERED",
    "PARTIAL DELIVERED",
  ]);
  const allowedPrStatuses = new Set([
    "PENDING",
    "DELIVERED",
    "DELIVERED PARTIAL",
    "pending",
    "finish",
  ]);
  if (deliveryStatus && !allowedDeliveryStatuses.has(deliveryStatus.toUpperCase())) {
    throw new Error("Invalid delivery status.");
  }
  if (prStatus && !allowedPrStatuses.has(prStatus)) {
    throw new Error("Invalid order status.");
  }
  const dateNeeded = optionalText(input, "date_needed", 10);
  if (dateNeeded && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) {
    throw new Error("Date Needed must use YYYY-MM-DD format.");
  }
  const adjustmentRemarks = optionalText(input, "adjustment_remarks", 5000);

  return {
    item_name: requiredText(input, "item_name", 500),
    quantity,
    uom: requiredText(input, "uom", 100),
    remarks: optionalText(input, "remarks", 5000),
    machine_code: optionalText(input, "machine_code", 200),
    issuance_number: optionalText(input, "issuance_number", 200),
    pr_number: optionalText(input, "pr_number", 200),
    date_needed: dateNeeded,
    delivery_status: deliveryStatus?.toUpperCase() ?? null,
    pr_status: prStatus,
    quantity_delivered: optionalQuantity(input, "quantity_delivered"),
    quantity_out: optionalQuantity(input, "quantity_out"),
    adjustment_remarks: adjustmentRemarks ?? undefined,
  };
}

async function nextAdjustmentSerial(tx: Transaction, year: number): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"adjustment-serial-" + year}))`);
  const prefix = `ADJ-${year}-`;
  const rows = await tx
    .select({ adjustment_serial: adjustmentLog.adjustment_serial })
    .from(adjustmentLog)
    .where(like(adjustmentLog.adjustment_serial, `${prefix}%`));
  const nextNumber = rows.reduce((maximum, row) => {
    const match = row.adjustment_serial?.match(/-(\d+)$/);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  return `${prefix}${String(nextNumber).padStart(6, "0")}`;
}

export async function updateRequestItemAction(itemId: number, value: unknown): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  const role = user.role.trim().toLowerCase();
  if (!["custodian", "admin"].includes(role) || !user.permissions.includes("pending_items_services")) {
    throw new Error("Permission denied.");
  }
  if (!Number.isSafeInteger(itemId) || itemId < 1) throw new Error("Invalid item ID.");

  const input = parseInput(value);
  const db = getDb();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: itemRequestItems.id,
        request_id: itemRequestItems.request_id,
        item_name: itemRequestItems.item_name,
        quantity: itemRequestItems.quantity,
        uom: itemRequestItems.uom,
        remarks: itemRequestItems.remarks,
        machine_code: itemRequestItems.machine_code,
        issuance_number: itemRequestItems.issuance_number,
        pr_number: itemRequestItems.pr_number,
        date_needed: itemRequestItems.date_needed,
        delivery_status: itemRequestItems.delivery_status,
        pr_status: itemRequestItems.pr_status,
        pr_type: itemRequestItems.pr_type,
        quantity_delivered: itemRequestItems.quantity_delivered,
        quantity_out: itemRequestItems.quantity_out,
        hold_edited: itemRequestItems.hold_edited,
      })
      .from(itemRequestItems)
      .where(eq(itemRequestItems.id, itemId))
      .for("update");
    if (!item) throw new Error("Item not found.");

    const [request] = await tx
      .select({
        id: itemRequests.id,
        serial: itemRequests.serial,
        department: itemRequests.department,
        supervisor_status: itemRequests.supervisor_status,
      })
      .from(itemRequests)
      .where(eq(itemRequests.id, item.request_id))
      .limit(1);
    if (!request) throw new Error("Request not found.");
    if (request.supervisor_status !== "approved") {
      throw new Error("Only supervisor-approved requests can be updated by the custodian.");
    }
    if (input.delivery_status === "PURCHASE REQUEST" && (!input.pr_number || !input.pr_status)) {
      throw new Error("PR Number and PR Status are required.");
    }
    if (input.delivery_status === "URGENT" && !input.pr_status) {
      throw new Error("Status is required for an urgent item.");
    }

    const oldDelivered = item.quantity_delivered ?? 0;
    const oldOut = item.quantity_out ?? 0;
    const deliveredNow = input.quantity_delivered ?? 0;
    const releasedNow = input.quantity_out ?? 0;
    if (oldDelivered + deliveredNow > input.quantity) {
      throw new Error("Delivered quantity cannot exceed the requested quantity.");
    }
    if (oldOut + releasedNow > input.quantity) {
      throw new Error("Issued quantity cannot exceed the requested quantity.");
    }
    if (releasedNow > 0 && !input.issuance_number) {
      throw new Error("Issuance Number is required when recording an OUT quantity.");
    }

    const updatedDelivered = oldDelivered + deliveredNow;
    const updatedOut = oldOut + releasedNow;
    const normalizedNewName = input.item_name.trim().toUpperCase();
    const deliveryStatusChanged = input.delivery_status !== item.delivery_status;
    const newPrType =
      input.delivery_status === "PURCHASE REQUEST" || input.delivery_status === "URGENT"
        ? input.delivery_status
        : item.pr_type;

    await tx
      .update(itemRequestItems)
      .set({
        item_name: input.item_name,
        quantity: input.quantity,
        uom: input.uom,
        remarks: input.remarks,
        machine_code: input.machine_code,
        issuance_number: input.issuance_number,
        pr_number: input.pr_number,
        date_needed: input.date_needed,
        delivery_status: input.delivery_status,
        pr_status: input.pr_status,
        pr_type: newPrType,
        quantity_delivered: deliveredNow > 0 ? updatedDelivered : item.quantity_delivered,
        quantity_out: releasedNow > 0 ? updatedOut : item.quantity_out,
        qty_balance: Math.max(0, input.quantity - updatedOut),
        hold_edited:
          input.delivery_status === "HOLD" && item.delivery_status !== "HOLD"
            ? false
            : deliveryStatusChanged
              ? false
              : item.hold_edited,
      })
      .where(eq(itemRequestItems.id, itemId));

    const auditRows = [];
    if (deliveredNow > 0) {
      auditRows.push({
        item_request_item_id: item.id,
        request_id: request.id,
        issuance_number: input.pr_number ?? input.issuance_number ?? request.serial,
        transaction_type: updatedDelivered >= input.quantity ? "FULL" : "PARTIAL",
        quantity_issued: deliveredNow,
        remaining_balance: Math.max(0, input.quantity - updatedDelivered),
        custodian_id: user.id,
        custodian_name: user.name,
        issued_at: now,
      });
    }
    if (releasedNow > 0) {
      auditRows.push({
        item_request_item_id: item.id,
        request_id: request.id,
        issuance_number: input.issuance_number!,
        transaction_type: "OUT",
        quantity_issued: releasedNow,
        remaining_balance: Math.max(0, input.quantity - updatedOut),
        custodian_id: user.id,
        custodian_name: user.name,
        issued_at: now,
      });
    }
    if (auditRows.length) await tx.insert(itemIssuanceAudits).values(auditRows);

    if (input.adjustment_remarks) {
      const changes = [
        ["Item Name", item.item_name, input.item_name],
        ["Quantity", String(item.quantity), String(input.quantity)],
        ["UoM", item.uom, input.uom],
        ["Remarks", item.remarks ?? "", input.remarks ?? ""],
        ["Machine Code", item.machine_code ?? "", input.machine_code ?? ""],
      ].filter(([, before, after]) => before !== after);
      if (changes.length > 0) {
        const siblings = await tx
          .select({ id: itemRequestItems.id })
          .from(itemRequestItems)
          .where(eq(itemRequestItems.request_id, request.id))
          .orderBy(itemRequestItems.id);
        const itemNumber = siblings.findIndex((row) => row.id === item.id) + 1;
        const adjustmentSerial = await nextAdjustmentSerial(tx, new Date().getFullYear());
        await tx.insert(adjustmentLog).values(
          changes.map(([field, before, after]) => ({
            adjustment_serial: adjustmentSerial,
            request_id: request.id,
            request_type: "item",
            request_serial: request.serial,
            department: request.department,
            item_label: `Item #${itemNumber} — ${normalizedNewName}`,
            field: field!,
            before_value: before!,
            after_value: after!,
            adjustment_remarks: input.adjustment_remarks!,
            adjusted_by: user.id,
            adjusted_by_name: user.name,
            adjusted_by_role: user.role,
            adjusted_by_department: user.department,
            adjusted_at: now,
          }))
        );
      }
    }
  });
}
