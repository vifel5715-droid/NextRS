"use server";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { PaymentRequestForm, SubmittedPaymentRequest } from "@shared/types";
import { runAction, type ActionResult } from "../action-result";
import {
  asRecord,
  assertId,
  moneyString,
  optionalIsoDate,
  optionalString,
  requiredString,
  requireDepartmentAccess,
  requirePermission,
  requireRole,
  requireUser,
} from "../access";
import { getDb } from "../db";
import { urgentRequestItems, urgentRequests } from "../db/schema";
import {
  listSubmittedPaymentRequests,
  readPaymentRequestForm,
  savePaymentRequestForm,
  submitPaymentRequestForm,
} from "../payment-request-forms";
import { publishRequestChanged } from "../realtime";

// A repeat of the exact same submission inside this window is treated as an
// accidental double submit rather than a second request.
const DUPLICATE_WINDOW_MS = 30_000;

interface UrgentItemInput {
  item_description: string;
  quantity: number;
  uom: string | null;
}

function parseUrgentItems(value: unknown): UrgentItemInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Enter at least one item.");
  if (value.length > 100) throw new Error("An urgent request can have at most 100 items.");
  return value.map((entry, index) => {
    const item = asRecord(entry, `item #${index + 1}`);
    const label = `Item #${index + 1}`;
    const description = requiredString(item, "item_description", 1000, `${label} description`);
    const quantity = item.quantity;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999_999) {
      throw new Error(`${label}: quantity must be a whole number between 1 and 999,999.`);
    }
    const uom = optionalString(item, "uom", 20, `${label} UoM`);
    return { item_description: description.toUpperCase(), quantity, uom: uom ? uom.toUpperCase() : null };
  });
}

async function loadUrgentRequest(id: number) {
  const [request] = await getDb().select().from(urgentRequests).where(eq(urgentRequests.id, id)).limit(1);
  if (!request) throw new Error("Urgent request not found.");
  return request;
}

/**
 * Creates an Urgent Request and its free-style items in one transaction, so
 * a header can never exist without its items. Serial "URG-<year>-NNNNNN",
 * allocated under an advisory lock (legacy "URG-00-<year>-" serials are
 * still counted so numbering continues from them).
 */
export async function createUrgentRequestAction(value: unknown): Promise<ActionResult<{ id: number; serial: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["create_request"]);
    const input = asRecord(value);
    const department = requiredString(input, "department", 100).toUpperCase();
    if (department !== user.department.trim().toUpperCase() && !["admin", "secretary"].includes(user.roleKey)) {
      throw new Error("You can only create requests for your department.");
    }
    const requestedBy = optionalString(input, "requested_by", 200) || user.name;
    const purpose = requiredString(input, "purpose", 2000).toUpperCase();
    const remarks = optionalString(input, "remarks", 5000);
    const dateNeeded = optionalIsoDate(input.date_needed, "Date Needed") ?? null;
    const items = parseUrgentItems(input.items);

    const db = getDb();
    const now = new Date();
    const year = now.getFullYear();
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`urgent-request-serial-${year}`}))`);

      const recent = await tx
        .select({ id: urgentRequests.id, serial: urgentRequests.serial, purpose: urgentRequests.purpose })
        .from(urgentRequests)
        .where(
          and(
            eq(urgentRequests.created_by, user.id),
            eq(urgentRequests.purpose, purpose),
            gte(urgentRequests.created_at, new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString())
          )
        )
        .orderBy(desc(urgentRequests.created_at))
        .limit(1);
      if (recent[0]) {
        throw new Error(`This urgent request was already submitted as ${recent[0].serial}.`);
      }

      const serials = await tx
        .select({ serial: urgentRequests.serial })
        .from(urgentRequests)
        .where(sql`${urgentRequests.serial} LIKE ${`URG-${year}-%`} OR ${urgentRequests.serial} LIKE ${`URG-00-${year}-%`}`);
      const nextNumber =
        serials.reduce((maximum, row) => {
          const match = /-(\d+)$/.exec(row.serial);
          return match ? Math.max(maximum, Number(match[1])) : maximum;
        }, 0) + 1;
      const serial = `URG-${year}-${String(nextNumber).padStart(6, "0")}`;

      const [request] = await tx
        .insert(urgentRequests)
        .values({
          serial,
          department,
          created_by: user.id,
          requested_by: requestedBy,
          purpose,
          remarks: remarks ? remarks.toUpperCase() : null,
          date_needed: dateNeeded,
          supervisor_status: "pending",
          stockroom_status: "pending",
          created_at: now.toISOString(),
        })
        .returning({ id: urgentRequests.id, serial: urgentRequests.serial });
      if (!request) throw new Error("Failed to create the urgent request.");

      await tx.insert(urgentRequestItems).values(
        items.map((item) => ({
          request_id: request.id,
          item_description: item.item_description,
          quantity: item.quantity,
          uom: item.uom,
          // Stockroom classifies Inventoriable during its review.
          is_inventoriable: false,
          created_at: now.toISOString(),
        }))
      );
      return request;
    });

    await publishRequestChanged({ type: "urgent", action: "created", id: created.id, department });
    return created;
  });
}

function parseDecision(value: unknown): { decision: "approved" | "rejected"; comment: string | null } {
  const input = asRecord(value);
  if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Invalid review decision.");
  const comment = optionalString(input, "rejection_comment", 500, "decline reason") ?? "";
  if (input.decision === "rejected" && !comment) throw new Error("A reason is required to decline a request.");
  return { decision: input.decision, comment: input.decision === "rejected" ? comment.toUpperCase() : null };
}

/** Stockroom (Custodian) review — only after Supervisor/Manager approval. */
export async function reviewUrgentAsStockroomAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "urgent_items"]);
    requireRole(user, ["custodian", "admin", "director", "operations_manager"]);
    assertId(id, "request ID");
    const { decision, comment } = parseDecision(value);

    const request = await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(urgentRequests).where(eq(urgentRequests.id, id)).for("update");
      if (!existing) throw new Error("Urgent request not found.");
      if (existing.supervisor_status !== "approved") {
        throw new Error("Awaiting Supervisor/Manager approval before Stockroom can review this request.");
      }
      if (existing.stockroom_status !== "pending") throw new Error("This request has already been reviewed.");
      await tx
        .update(urgentRequests)
        .set({
          stockroom_status: decision,
          stockroom_approved_by: user.id,
          stockroom_approved_at: new Date().toISOString(),
          rejection_comment: comment,
        })
        .where(eq(urgentRequests.id, id));
      return existing;
    });
    await publishRequestChanged({ type: "urgent", action: "updated", id, department: request.department });
  });
}

async function loadUrgentItem(requestId: number, itemId: number) {
  const [item] = await getDb()
    .select()
    .from(urgentRequestItems)
    .where(and(eq(urgentRequestItems.id, itemId), eq(urgentRequestItems.request_id, requestId)))
    .limit(1);
  if (!item) throw new Error("Urgent request item not found.");
  return item;
}

/** Purchaser routes one item: Purchase Order, or Payment Request with an amount. */
export async function setUrgentItemTransactionAction(
  requestId: number,
  itemId: number,
  value: unknown
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["purchaser_dashboard"]);
    assertId(requestId, "request ID");
    assertId(itemId, "item ID");
    const input = asRecord(value);
    const transaction = input.purchasing_transaction;
    if (transaction !== "purchase_order" && transaction !== "payment_request") {
      throw new Error("Choose Purchase Order or Payment Request.");
    }
    let amount: string | null = null;
    if (transaction === "payment_request") {
      if (input.amount === undefined || input.amount === null || input.amount === "") {
        throw new Error("Amount is required for a Payment Request item.");
      }
      amount = moneyString(input.amount, "Amount");
    }

    const request = await loadUrgentRequest(requestId);
    if (request.stockroom_status !== "approved" && request.stockroom_status !== "not_required") {
      throw new Error("Only Stockroom-approved requests can be routed by Purchasing.");
    }
    await loadUrgentItem(requestId, itemId);
    await getDb()
      .update(urgentRequestItems)
      .set({ purchasing_transaction: transaction, amount })
      .where(eq(urgentRequestItems.id, itemId));
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department: request.department });
  });
}

/** Requesting department self-attests delivery of a Not Inventoriable item. */
export async function setUrgentItemDeliveryStatusAction(
  requestId: number,
  itemId: number,
  value: unknown
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["create_request"]);
    assertId(requestId, "request ID");
    assertId(itemId, "item ID");
    const input = asRecord(value);
    const status = input.delivery_status;
    if (status !== "pending" && status !== "delivered" && status !== "partial_delivered") {
      throw new Error("Invalid delivery status.");
    }
    const quantityDelivered = input.quantity_delivered;
    if (
      status !== "pending" &&
      (typeof quantityDelivered !== "number" || !Number.isSafeInteger(quantityDelivered) || quantityDelivered < 0)
    ) {
      throw new Error("Quantity delivered is required once the item is marked delivered or partially delivered.");
    }

    const request = await loadUrgentRequest(requestId);
    requireDepartmentAccess(user, request.department);
    const item = await loadUrgentItem(requestId, itemId);
    if (item.is_inventoriable) throw new Error("Only Not Inventoriable items track delivery here.");
    if (status !== "pending" && item.quantity !== null && (quantityDelivered as number) > item.quantity) {
      throw new Error("Quantity delivered can't exceed the requested quantity.");
    }

    await getDb()
      .update(urgentRequestItems)
      .set({
        delivery_status: status,
        quantity_delivered: status === "pending" ? null : (quantityDelivered as number),
        delivered_by: status === "pending" ? null : user.id,
        delivered_at: status === "pending" ? null : new Date().toISOString(),
      })
      .where(eq(urgentRequestItems.id, itemId));
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department: request.department });
  });
}

/** Stockroom's Inventoriable classification — only during/after its review. */
export async function setUrgentItemInventoriableAction(
  requestId: number,
  itemId: number,
  value: unknown
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "urgent_items"]);
    requireRole(user, ["custodian", "admin", "director", "operations_manager"]);
    assertId(requestId, "request ID");
    assertId(itemId, "item ID");
    const input = asRecord(value);
    if (typeof input.is_inventoriable !== "boolean") throw new Error("Invalid Inventoriable value.");

    const request = await loadUrgentRequest(requestId);
    if (request.supervisor_status !== "approved") {
      throw new Error("Awaiting Supervisor/Manager approval before Stockroom can classify items.");
    }
    if (request.stockroom_status === "rejected") throw new Error("This request was declined by Stockroom.");
    await loadUrgentItem(requestId, itemId);
    await getDb()
      .update(urgentRequestItems)
      .set({ is_inventoriable: input.is_inventoriable })
      .where(eq(urgentRequestItems.id, itemId));
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department: request.department });
  });
}

/** "New Item List" — the Item Catalog entry an Inventoriable item was registered as. */
export async function setUrgentItemCatalogLinkAction(
  requestId: number,
  itemId: number,
  value: unknown
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["new_item_list"]);
    assertId(requestId, "request ID");
    assertId(itemId, "item ID");
    const name = optionalString(asRecord(value), "catalog_item_name", 255, "Item Catalog name");

    const request = await loadUrgentRequest(requestId);
    await loadUrgentItem(requestId, itemId);
    await getDb()
      .update(urgentRequestItems)
      .set({ catalog_item_name: name ? name.toUpperCase() : null })
      .where(eq(urgentRequestItems.id, itemId));
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department: request.department });
  });
}

const FORM_VIEW_PERMISSIONS = ["create_request", "urgent_items", "supervisor_dashboard", "purchaser_dashboard", "submitted_payment_requests", "ap_officer_dashboard"];
const FORM_EDIT_PERMISSIONS = ["purchaser_dashboard", "ap_officer_dashboard"];

export async function getUrgentPaymentRequestFormAction(requestId: number): Promise<ActionResult<PaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, FORM_VIEW_PERMISSIONS);
    assertId(requestId, "request ID");
    return (await readPaymentRequestForm("urgent", requestId, user)) as PaymentRequestForm;
  });
}

export async function saveUrgentPaymentRequestFormAction(
  requestId: number,
  value: unknown
): Promise<ActionResult<PaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, FORM_EDIT_PERMISSIONS);
    assertId(requestId, "request ID");
    const { department } = await savePaymentRequestForm("urgent", requestId, value, user);
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department });
    return (await readPaymentRequestForm("urgent", requestId, user)) as PaymentRequestForm;
  });
}

export async function submitUrgentPaymentRequestFormAction(requestId: number): Promise<ActionResult<PaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["purchaser_dashboard"]);
    assertId(requestId, "request ID");
    const { department } = await submitPaymentRequestForm("urgent", requestId, user);
    await publishRequestChanged({ type: "urgent", action: "updated", id: requestId, department });
    return (await readPaymentRequestForm("urgent", requestId, user)) as PaymentRequestForm;
  });
}

export async function getSubmittedUrgentPaymentRequestsAction(): Promise<ActionResult<SubmittedPaymentRequest[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["submitted_payment_requests"]);
    return listSubmittedPaymentRequests("urgent", user);
  });
}
