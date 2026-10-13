"use server";

import { eq } from "drizzle-orm";
import { isMachineCodeEnabled } from "@/lib/utils/machineCodeValidation";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser, type AuthorizedUser } from "@/lib/auth";
import {
  isHoldResolver,
  isRequestOwner,
  requireDepartmentAccess,
  requirePermission,
} from "@/lib/permissions";
import { logAdjustments } from "@/server/audit/adjustments";
import { getDb } from "@/lib/db";
import { publishRequestChanged } from "@/lib/realtime";
import { itemIssuanceAudits, itemRequestItems, itemRequests } from "@/db/schema";

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

type ExistingItem = typeof itemRequestItems.$inferSelect;

const DETAIL_FIELDS = ["item_name", "quantity", "uom", "remarks", "machine_code"] as const;
const CUSTODIAN_ONLY_FIELDS = ["delivery_status", "issuance_number", "pr_number", "pr_status", "date_needed"] as const;

const normalized = (value: string | number | null | undefined) =>
  typeof value === "string" ? value.trim() || null : value ?? null;
const differs = (before: string | number | null | undefined, after: string | number | null | undefined) =>
  normalized(before) !== normalized(after);

/**
 * Who may save this row, and how. Ported from the legacy
 * status.service.ts updateRequestItem:
 *
 *  - "custodian"/"admin": the full Pending Requests editor. A custodian is
 *    locked out of a HOLD item's details (only its status may change) —
 *    that's the hand-off to Secretary/Supervisor/Manager.
 *  - "hold": Secretary/Supervisor/Manager on the Held Items page — or Staff,
 *    on their own request only. Only a row that is on HOLD, only name/qty/UoM/remarks/machine code, never the
 *    status or any custodian bookkeeping field. Saving keeps the item on
 *    HOLD and flags it hold_edited ("RELEASE ON HOLD") for the custodian.
 */
function resolveEditMode(
  user: AuthorizedUser,
  item: ExistingItem,
  input: ItemUpdateValues,
  request: { department: string; created_by: string; requested_by: string | null }
): "custodian" | "hold" {
  const { department } = request;
  if (user.roleKey === "admin") return "custodian";

  if (user.roleKey === "custodian") {
    requirePermission(user, ["pending_items_services", "department_requests", "complete_requests"]);
    if (item.delivery_status === "HOLD" && DETAIL_FIELDS.some((field) => differs(item[field], input[field]))) {
      throw new Error(
        "This item is on HOLD — only its status can be changed until Secretary, Supervisor, or Manager corrects the other details."
      );
    }
    return "custodian";
  }

  const isOwnStaffRequest = user.roleKey === "staff";
  if (isHoldResolver(user) || isOwnStaffRequest) {
    if (isOwnStaffRequest) {
      requirePermission(user, ["create_request"]);
      requireDepartmentAccess(user, department);
      if (!isRequestOwner(user, request)) throw new Error("You can only correct held items on your own request.");
    } else {
      requirePermission(user, ["held_items"]);
      if (user.roleKey === "secretary") requireDepartmentAccess(user, department);
    }
    if (item.delivery_status !== "HOLD") {
      throw new Error("You can only act on an item that is currently on HOLD.");
    }
    if (
      CUSTODIAN_ONLY_FIELDS.some((field) => differs(item[field], input[field])) ||
      input.quantity_delivered ||
      input.quantity_out
    ) {
      throw new Error("You can only change the item name, quantity, UoM, remarks, or machine code of a HOLD item.");
    }
    if (!isMachineCodeEnabled(department) && differs(item.machine_code, input.machine_code)) {
      throw new Error("Machine Code only applies to Engineering (ENGG) requests — leave it as N/A.");
    }
    return "hold";
  }

  throw new Error("Permission denied.");
}

function nextHoldEdited(mode: "custodian" | "hold", item: ExistingItem, input: ItemUpdateValues): boolean {
  if (mode === "hold") return true;
  // Any explicit status change by custodian/admin starts a fresh HOLD cycle.
  if (input.delivery_status !== item.delivery_status) return false;
  return item.hold_edited;
}

export async function updateRequestItemAction(itemId: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    if (!Number.isSafeInteger(itemId) || itemId < 1) throw new Error("Invalid item ID.");

    const input = parseInput(value);
    const db = getDb();
    const now = new Date().toISOString();

    const request = await db.transaction(async (tx) => {
      const [item] = await tx
        .select()
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
          created_by: itemRequests.created_by,
          requested_by: itemRequests.requested_by,
        })
        .from(itemRequests)
        .where(eq(itemRequests.id, item.request_id))
        .limit(1);
      if (!request) throw new Error("Request not found.");

      const mode = resolveEditMode(user, item, input, request);
      if (mode === "custodian") {
        if (request.supervisor_status !== "approved") {
          throw new Error("Only supervisor-approved requests can be updated by the custodian.");
        }
        if (input.delivery_status === "PURCHASE REQUEST" && (!input.pr_number || !input.pr_status)) {
          throw new Error("PR Number and PR Status are required.");
        }
        if (input.delivery_status === "URGENT" && !input.pr_status) {
          throw new Error("Status is required for an urgent item.");
        }
      }

      const oldDelivered = item.quantity_delivered ?? 0;
      const oldOut = item.quantity_out ?? 0;
      const deliveredNow = input.quantity_delivered ?? 0;
      const releasedNow = input.quantity_out ?? 0;
      if (input.quantity < Math.max(oldDelivered, oldOut)) {
        throw new Error(
          `"${item.item_name}" already has ${Math.max(oldDelivered, oldOut)} recorded — the quantity cannot be lowered below that.`
        );
      }
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
          hold_edited: nextHoldEdited(mode, item, input),
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
        const siblings = await tx
          .select({ id: itemRequestItems.id })
          .from(itemRequestItems)
          .where(eq(itemRequestItems.request_id, request.id))
          .orderBy(itemRequestItems.id);
        const itemNumber = siblings.findIndex((row) => row.id === item.id) + 1;
        await logAdjustments(tx, {
          user,
          requestId: request.id,
          requestType: "item",
          requestSerial: request.serial,
          department: request.department,
          itemLabel: `Item #${itemNumber} — ${input.item_name.toUpperCase()}`,
          remarks: input.adjustment_remarks,
          changes: [
            ["Item Name", item.item_name, input.item_name],
            ["Quantity", String(item.quantity), String(input.quantity)],
            ["UoM", item.uom, input.uom],
            ["Remarks", item.remarks ?? "", input.remarks ?? ""],
            ["Machine Code", item.machine_code ?? "", input.machine_code ?? ""],
          ],
        });
      }
      return request;
    });

    await publishRequestChanged({ type: "item", action: "updated", id: request.id, department: request.department });
  });
}
