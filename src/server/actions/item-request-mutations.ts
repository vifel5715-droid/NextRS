"use server";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { ItemPaymentRequestForm, SubmittedPaymentRequest } from "@shared/types";
import type { PurchasePaymentItem } from "../../services/api";
import { runAction, type ActionResult } from "../action-result";
import {
  asRecord,
  assertId,
  isDepartmentScoped,
  isHoldResolver,
  isRequestOwner,
  moneyString,
  optionalString,
  requiredReason,
  requireDepartmentAccess,
  requirePermission,
  requireUser,
  type AuthorizedUser,
} from "../access";
import { logAdjustments, nextAdjustmentSerial } from "../adjustments";
import { getDb } from "../db";
import { deletionLog, itemRequestItems, itemRequests, serviceRequests } from "../db/schema";
import {
  listSubmittedPaymentRequests,
  readPaymentRequestForm,
  savePaymentRequestForm,
  submitPaymentRequestForm,
} from "../payment-request-forms";
import { publishRequestChanged } from "../realtime";

const MAX_ATTACHMENT_BYTES = 10.5 * 1024 * 1024;

async function loadItemRequest(id: number) {
  const [request] = await getDb().select().from(itemRequests).where(eq(itemRequests.id, id)).limit(1);
  if (!request) throw new Error("Request not found.");
  return request;
}

/**
 * Staff may only touch their own request, and Staff/Secretary only while
 * neither approval stage has acted — ported from the legacy
 * updateItemRequest/updateServiceRequest ownership rule.
 */
function assertRequesterMayEdit(
  user: AuthorizedUser,
  request: {
    created_by: string;
    requested_by: string | null;
    supervisor_status: string | null;
    custodian_status: string | null;
  }
): void {
  if (user.roleKey !== "staff" && user.roleKey !== "secretary") return;
  if (user.roleKey === "staff" && !isRequestOwner(user, request)) {
    throw new Error("You can only edit your own request.");
  }
  const reviewed = (status: string | null) => status === "approved" || status === "rejected";
  if (reviewed(request.supervisor_status) || reviewed(request.custodian_status)) {
    throw new Error("This request has already been reviewed and can no longer be edited.");
  }
}

// ---------------------------------------------------------------------------
// Request header + items edit (Staff edit modal, Supervisor edit, Admin edit,
// custodian "Save request info").
// ---------------------------------------------------------------------------

interface IncomingItem {
  id?: number;
  item_name?: string;
  quantity?: number;
  uom?: string;
  remarks?: string | null;
  machine_code?: string | null;
  delivery_status?: string | null;
  pr_number?: string | null;
  pr_status?: string | null;
  issuance_number?: string | null;
}

function parseIncomingItems(value: unknown): IncomingItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("Invalid item list.");
  return value.map((entry, index) => {
    const item = asRecord(entry, `item #${index + 1}`);
    const label = `Item #${index + 1}`;
    const quantity = item.quantity;
    if (quantity !== undefined && (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999_999)) {
      throw new Error(`${label}: quantity must be a whole number of at least 1.`);
    }
    const itemName = optionalString(item, "item_name", 500, `${label} name`);
    if (itemName !== undefined && !itemName) throw new Error(`${label}: Item Name cannot be blank.`);
    const uom = optionalString(item, "uom", 100, `${label} UoM`);
    return {
      id: typeof item.id === "number" && Number.isSafeInteger(item.id) ? item.id : undefined,
      item_name: itemName ?? undefined,
      quantity: quantity as number | undefined,
      uom: uom ?? undefined,
      remarks: optionalString(item, "remarks", 5000, `${label} remarks`),
      machine_code: optionalString(item, "machine_code", 200, `${label} machine code`),
      delivery_status: optionalString(item, "delivery_status", 50, `${label} status`),
      pr_number: optionalString(item, "pr_number", 200, `${label} PR number`),
      pr_status: optionalString(item, "pr_status", 50, `${label} order status`),
      issuance_number: optionalString(item, "issuance_number", 200, `${label} issuance number`),
    };
  });
}

export async function updateItemRequestAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["create_request", "department_requests", "supervisor_dashboard"]);
    assertId(id, "request ID");
    const input = asRecord(value);
    const purpose = optionalString(input, "purpose", 2000);
    if (purpose !== undefined && !purpose) throw new Error("Purpose is required.");
    const remarks = optionalString(input, "remarks", 5000);
    const items = parseIncomingItems(input.items);
    const adjustmentRemarks = optionalString(input, "adjustment_remarks", 5000) ?? "";
    // Only custodian/admin own delivery/PR/issuance bookkeeping — a requester's
    // edit form may echo those fields back, but they're never applied from it.
    const mayEditBookkeeping = user.roleKey === "custodian" || user.roleKey === "admin";

    const request = await loadItemRequest(id);
    requireDepartmentAccess(user, request.department);
    assertRequesterMayEdit(user, request);

    await getDb().transaction(async (tx) => {
      const header: Partial<typeof itemRequests.$inferInsert> = {};
      if (purpose !== undefined) header.purpose = purpose;
      if (remarks !== undefined) header.remarks = remarks || null;
      if (Object.keys(header).length > 0) {
        await tx.update(itemRequests).set(header).where(eq(itemRequests.id, id));
      }
      if (!items) return;

      if (items.length === 0) throw new Error("A request must keep at least one item.");
      // Reconciled by id rather than delete-and-reinsert, which would cascade
      // away the issuance audit history of every untouched row.
      const existingItems = await tx
        .select()
        .from(itemRequestItems)
        .where(eq(itemRequestItems.request_id, id))
        .orderBy(asc(itemRequestItems.id))
        .for("update");
      const existingById = new Map(existingItems.map((item) => [item.id, item]));
      const keptIds = new Set<number>();
      const adjustmentSerial = adjustmentRemarks ? await nextAdjustmentSerial(tx) : undefined;

      for (const incoming of items) {
        const existing = incoming.id !== undefined ? existingById.get(incoming.id) : undefined;
        if (existing) {
          keptIds.add(existing.id);
          const quantity = incoming.quantity ?? existing.quantity;
          const alreadyMoved = Math.max(existing.quantity_out ?? 0, existing.quantity_delivered ?? 0);
          if (quantity < alreadyMoved) {
            throw new Error(`"${existing.item_name}" already has ${alreadyMoved} recorded — the quantity cannot be lowered below that.`);
          }
          const patch: Partial<typeof itemRequestItems.$inferInsert> = {};
          if (incoming.item_name !== undefined) patch.item_name = incoming.item_name;
          if (incoming.uom !== undefined) patch.uom = incoming.uom;
          if (incoming.remarks !== undefined) patch.remarks = incoming.remarks || null;
          if (incoming.machine_code !== undefined) patch.machine_code = incoming.machine_code || null;
          if (incoming.quantity !== undefined) {
            patch.quantity = quantity;
            patch.qty_balance = Math.max(0, quantity - (existing.quantity_out ?? 0));
          }
          if (mayEditBookkeeping) {
            if (incoming.delivery_status !== undefined) patch.delivery_status = incoming.delivery_status || null;
            if (incoming.pr_number !== undefined) patch.pr_number = incoming.pr_number || null;
            if (incoming.pr_status !== undefined) patch.pr_status = incoming.pr_status || null;
            if (incoming.issuance_number !== undefined) patch.issuance_number = incoming.issuance_number || null;
            if (incoming.delivery_status === "PURCHASE REQUEST" || incoming.delivery_status === "URGENT") {
              patch.pr_type = incoming.delivery_status;
            }
          }
          if (Object.keys(patch).length > 0) {
            await tx.update(itemRequestItems).set(patch).where(eq(itemRequestItems.id, existing.id));
          }
          if (adjustmentRemarks) {
            const position = existingItems.findIndex((item) => item.id === existing.id) + 1;
            await logAdjustments(tx, {
              user,
              requestId: id,
              requestType: "item",
              requestSerial: request.serial,
              department: request.department,
              itemLabel: `Item #${position} — ${(patch.item_name ?? existing.item_name).toUpperCase()}`,
              remarks: adjustmentRemarks,
              adjustmentSerial,
              changes: [
                ["Item Name", existing.item_name, patch.item_name ?? existing.item_name],
                ["Quantity", String(existing.quantity), String(patch.quantity ?? existing.quantity)],
                ["UoM", existing.uom, patch.uom ?? existing.uom],
                ["Remarks", existing.remarks ?? "", patch.remarks === undefined ? existing.remarks ?? "" : patch.remarks ?? ""],
                [
                  "Machine Code",
                  existing.machine_code ?? "",
                  patch.machine_code === undefined ? existing.machine_code ?? "" : patch.machine_code ?? "",
                ],
              ],
            });
          }
        } else {
          if (!incoming.item_name || !incoming.uom) throw new Error("New items need an Item Name and UoM.");
          const quantity = incoming.quantity ?? 1;
          const [created] = await tx
            .insert(itemRequestItems)
            .values({
              request_id: id,
              item_name: incoming.item_name,
              quantity,
              uom: incoming.uom,
              remarks: incoming.remarks || null,
              machine_code: incoming.machine_code || null,
              quantity_delivered: 0,
              quantity_out: 0,
              qty_balance: quantity,
            })
            .returning({ id: itemRequestItems.id });
          keptIds.add(created.id);
        }
      }

      // Only rows the caller actually dropped are removed — and never one that
      // already has stock released against it.
      const removed = existingItems.filter((item) => !keptIds.has(item.id));
      const released = removed.find((item) => (item.quantity_out ?? 0) > 0);
      if (released) {
        throw new Error(`"${released.item_name}" has already been released to the requester and cannot be removed.`);
      }
      if (removed.length > 0) {
        const now = new Date().toISOString();
        await tx.insert(deletionLog).values(
          removed.map((item) => ({
            request_type: "item",
            request_id: id,
            request_serial: request.serial,
            department: request.department,
            entity_name: item.item_name,
            quantity: item.quantity,
            uom: item.uom,
            reason: "Removed while editing the request",
            deleted_by: user.id,
            deleted_at: now,
          }))
        );
        await tx.delete(itemRequestItems).where(inArray(itemRequestItems.id, removed.map((item) => item.id)));
      }
    });

    await publishRequestChanged({ type: "item", action: "updated", id, department: request.department });
  });
}

// ---------------------------------------------------------------------------
// Delete one item line (Custodian Pending Requests, Held Items hand-off).
// ---------------------------------------------------------------------------

export async function deleteRequestItemAction(itemId: number, reasonInput: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "held_items"]);
    assertId(itemId, "item ID");
    const reason = requiredReason(reasonInput);

    const result = await getDb().transaction(async (tx) => {
      const [item] = await tx.select().from(itemRequestItems).where(eq(itemRequestItems.id, itemId)).for("update");
      if (!item) throw new Error("Item not found.");
      const [request] = await tx
        .select({ id: itemRequests.id, serial: itemRequests.serial, department: itemRequests.department })
        .from(itemRequests)
        .where(eq(itemRequests.id, item.request_id))
        .limit(1);
      if (!request) throw new Error("Request not found.");

      if ((item.quantity_out ?? 0) > 0) {
        throw new Error("Cannot delete an item that has already been released to the requester (Qty Out > 0).");
      }
      if (user.roleKey === "custodian" && item.delivery_status === "HOLD") {
        throw new Error("This item is on HOLD — only Secretary, Supervisor, or Manager can act on it.");
      }
      if (isHoldResolver(user)) {
        if (item.delivery_status !== "HOLD") throw new Error("You can only act on an item that is currently on HOLD.");
        if (user.roleKey === "secretary") requireDepartmentAccess(user, request.department);
      } else if (!["custodian", "admin", "director", "operations_manager"].includes(user.roleKey)) {
        throw new Error("Permission denied.");
      }

      await tx.insert(deletionLog).values({
        request_type: "item",
        request_id: request.id,
        request_serial: request.serial,
        department: request.department,
        entity_name: item.item_name,
        quantity: item.quantity,
        uom: item.uom,
        reason,
        deleted_by: user.id,
        deleted_at: new Date().toISOString(),
      });
      await tx.delete(itemRequestItems).where(eq(itemRequestItems.id, itemId));
      return request;
    });

    await publishRequestChanged({ type: "item", action: "updated", id: result.id, department: result.department });
  });
}

// ---------------------------------------------------------------------------
// Sidebar "needs my action" counters.
// ---------------------------------------------------------------------------

function parseDateBound(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export async function getPendingCountAction(
  type: "item" | "service",
  params?: { startDate?: string; endDate?: string }
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    const table = type === "service" ? serviceRequests : itemRequests;
    const startDate = parseDateBound(params?.startDate, "start date");
    const endDate = parseDateBound(params?.endDate, "end date");
    const department = user.department.trim().toUpperCase();
    const inDepartment = eq(sql`upper(trim(${table.department}))`, department);

    const conditions = [];
    if (user.roleKey === "custodian" || user.roleKey === "admin") {
      conditions.push(eq(table.supervisor_status, "approved"), eq(table.custodian_status, "pending"));
    } else if (user.roleKey === "supervisor" || user.roleKey === "manager") {
      conditions.push(eq(table.supervisor_status, "pending"), inDepartment);
    } else {
      conditions.push(eq(table.status, "pending"), inDepartment);
    }
    if (startDate) conditions.push(gte(table.created_at, startDate));
    if (endDate) conditions.push(lte(table.created_at, `${endDate}T23:59:59.999Z`));

    const [row] = await getDb()
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(table)
      .where(and(...conditions));
    return { count: Number(row?.count ?? 0) };
  });
}

// ---------------------------------------------------------------------------
// Supporting document (attachment) replace/remove.
// ---------------------------------------------------------------------------

async function readPdf(entry: FormDataEntryValue | null) {
  if (!(entry instanceof File) || entry.size === 0) throw new Error("Choose a PDF file to upload.");
  if (entry.size > MAX_ATTACHMENT_BYTES) throw new Error("PDF attachments cannot exceed 10.5 MB.");
  if (entry.type !== "application/pdf" || !entry.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF attachments are allowed.");
  }
  const bytes = Buffer.from(await entry.arrayBuffer());
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The attachment is not a valid PDF file.");
  }
  return { data: bytes, name: entry.name.replace(/[\\/\x00-\x1F\x7F]/g, "_").slice(0, 255) };
}

/**
 * Same audience as the legacy attachmentWriter route: requesters (Create New
 * Request page). Staff only on their own request; Secretary/Supervisor/
 * Manager within their department; admin anywhere.
 */
function assertAttachmentManager(
  user: AuthorizedUser,
  request: { department: string; created_by: string; requested_by: string | null }
): void {
  requirePermission(user, ["create_request"]);
  requireDepartmentAccess(user, request.department);
  if (user.roleKey === "admin") return;
  if (["secretary", "supervisor", "manager"].includes(user.roleKey)) return;
  if (!isRequestOwner(user, request)) throw new Error("You can only update your own request's attachment.");
}

export async function replaceItemAttachmentAction(formData: FormData): Promise<ActionResult<{ attachment_name: string; attachment_size: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    const id = assertId(Number(formData.get("id")), "request ID");
    // Validate the upload before touching the row, so a bad file can never
    // clear or corrupt the existing attachment.
    const file = await readPdf(formData.get("attachment"));
    const request = await loadItemRequest(id);
    assertAttachmentManager(user, request);
    // Name + size, so replacing a file with a same-named one is still logged.
    const describe = (name: string | null, size: number | null) => (name ? `${name} (${size ?? 0} bytes)` : "");
    const before = describe(request.attachment_name, request.attachment_size);
    const after = describe(file.name, file.data.length);

    await getDb().transaction(async (tx) => {
      await tx
        .update(itemRequests)
        .set({
          attachment: null,
          attachment_name: file.name,
          attachment_data: file.data,
          attachment_mime: "application/pdf",
          attachment_size: file.data.length,
        })
        .where(eq(itemRequests.id, id));
      await logAdjustments(tx, {
        user,
        requestId: id,
        requestType: "item",
        requestSerial: request.serial,
        department: request.department,
        itemLabel: "Supporting Document",
        remarks: request.attachment_name ? "Supporting document replaced" : "Supporting document added",
        changes: [["Attachment", before, after === before ? `${after} (re-uploaded)` : after]],
      });
    });

    await publishRequestChanged({ type: "item", action: "updated", id, department: request.department });
    return { attachment_name: file.name, attachment_size: file.data.length };
  });
}

export async function deleteItemAttachmentAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    assertId(id, "request ID");
    const request = await loadItemRequest(id);
    assertAttachmentManager(user, request);
    if (!request.attachment_name) throw new Error("This request has no attachment to remove.");

    await getDb().transaction(async (tx) => {
      await tx
        .update(itemRequests)
        .set({ attachment: null, attachment_name: null, attachment_data: null, attachment_mime: null, attachment_size: null })
        .where(eq(itemRequests.id, id));
      await logAdjustments(tx, {
        user,
        requestId: id,
        requestType: "item",
        requestSerial: request.serial,
        department: request.department,
        itemLabel: "Supporting Document",
        remarks: "Supporting document removed",
        changes: [["Attachment", request.attachment_name ?? "", ""]],
      });
    });
    await publishRequestChanged({ type: "item", action: "updated", id, department: request.department });
  });
}

// ---------------------------------------------------------------------------
// "Urgent Item From IRS" / "Pending Purchase Items" / "Pending Item Entry".
// ---------------------------------------------------------------------------

/**
 * Every item ever routed through a Purchase Request or flagged URGENT,
 * active or not. Filters on pr_type — the snapshot taken when the item was
 * set to PURCHASE REQUEST/URGENT — rather than delivery_status, because
 * delivery_status moves on (DELIVERED/HOLD/OUT) and the page must still show
 * those, tagged inactive. Ported from the legacy getPurchasePaymentItems,
 * without its 20-request cap (the cap silently hid older urgent items from
 * the date-range filter).
 */
export async function getPurchasePaymentItemsAction(): Promise<ActionResult<PurchasePaymentItem[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["pending_items_services", "urgent_items", "pending_item_entry"]);
    const db = getDb();

    const purchaseFilter = inArray(itemRequestItems.pr_type, ["PURCHASE REQUEST", "URGENT"]);
    const requestConditions = [
      inArray(itemRequests.id, db.select({ id: itemRequestItems.request_id }).from(itemRequestItems).where(purchaseFilter)),
    ];
    if (isDepartmentScoped(user)) {
      requestConditions.push(eq(sql`upper(trim(${itemRequests.department}))`, user.department.trim().toUpperCase()));
    }
    const requests = await db
      .select({
        id: itemRequests.id,
        serial: itemRequests.serial,
        purpose: itemRequests.purpose,
        status: itemRequests.status,
        supervisor_status: itemRequests.supervisor_status,
        custodian_status: itemRequests.custodian_status,
        created_at: itemRequests.created_at,
      })
      .from(itemRequests)
      .where(and(...requestConditions))
      .orderBy(desc(itemRequests.created_at));
    if (requests.length === 0) return [];

    const items = await db
      .select()
      .from(itemRequestItems)
      .where(and(purchaseFilter, inArray(itemRequestItems.request_id, requests.map((request) => request.id))))
      .orderBy(asc(itemRequestItems.id));

    const itemsByRequest = new Map<number, PurchasePaymentItem["items"]>();
    for (const item of items) {
      // A fully-arrived item counts as delivered even if the custodian never
      // flipped delivery_status off PURCHASE REQUEST/URGENT.
      const deliveredInFact =
        (item.quantity_delivered ?? 0) >= item.quantity ||
        item.delivery_status === "DELIVERED" ||
        item.pr_status === "DELIVERED";
      const effectiveStatus =
        deliveredInFact && (item.delivery_status === "PURCHASE REQUEST" || item.delivery_status === "URGENT")
          ? "DELIVERED"
          : item.delivery_status;
      const list = itemsByRequest.get(item.request_id) ?? [];
      list.push({
        id: item.id,
        item_name: item.item_name,
        delivery_status: effectiveStatus,
        pr_type: item.pr_type,
        pr_number: item.pr_number,
        quantity: item.quantity,
        uom: item.uom,
        partial_qty: Math.max(0, item.quantity - (item.quantity_delivered ?? 0)),
        quantity_out: item.quantity_out ?? 0,
        qty_balance: Math.max(0, item.quantity - (item.quantity_out ?? 0)),
        machine_code: item.machine_code,
        date_needed: item.date_needed,
        purchasing_transaction: item.purchasing_transaction as "purchase_order" | "payment_request" | null,
        amount: item.amount,
        is_inventoriable: item.is_inventoriable,
        catalog_item_name: item.catalog_item_name,
        // Still sitting at the PR/Urgent stage — once it moves on (delivered,
        // held, or released OUT) delivery_status no longer matches pr_type.
        is_active: item.delivery_status === item.pr_type && !deliveredInFact,
      });
      itemsByRequest.set(item.request_id, list);
    }

    return requests
      .map((request) => ({ ...request, status: request.status, items: itemsByRequest.get(request.id) ?? [] }))
      .filter((request) => request.items.length > 0);
  });
}

async function loadRequestItemForClassification(itemId: number, user: AuthorizedUser) {
  const db = getDb();
  const [item] = await db.select().from(itemRequestItems).where(eq(itemRequestItems.id, itemId)).limit(1);
  if (!item) throw new Error("Item not found.");
  const [request] = await db
    .select({ id: itemRequests.id, department: itemRequests.department })
    .from(itemRequests)
    .where(eq(itemRequests.id, item.request_id))
    .limit(1);
  if (!request) throw new Error("Request not found.");
  requireDepartmentAccess(user, request.department);
  return { item, request };
}

export async function setItemPurchasingTransactionAction(
  itemId: number,
  value: unknown
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["urgent_items"]);
    assertId(itemId, "item ID");
    const input = asRecord(value);
    const transaction = input.purchasing_transaction;
    if (transaction !== "purchase_order" && transaction !== "payment_request") {
      throw new Error("Choose Purchase Order or Payment Request.");
    }
    const amount =
      transaction === "payment_request"
        ? (() => {
            if (input.amount === undefined || input.amount === null || input.amount === "") {
              throw new Error("Amount is required for a Payment Request item.");
            }
            return moneyString(input.amount, "Amount");
          })()
        : null;

    const { item, request } = await loadRequestItemForClassification(itemId, user);
    if (item.pr_type !== "URGENT") throw new Error("Only items flagged URGENT can be classified here.");
    await getDb()
      .update(itemRequestItems)
      .set({ purchasing_transaction: transaction, amount })
      .where(eq(itemRequestItems.id, itemId));
    await publishRequestChanged({ type: "item", action: "updated", id: request.id, department: request.department });
  });
}

export async function setItemInventoriableAction(itemId: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["urgent_items"]);
    assertId(itemId, "item ID");
    const input = asRecord(value);
    if (typeof input.is_inventoriable !== "boolean") throw new Error("Invalid Inventoriable value.");

    const { request } = await loadRequestItemForClassification(itemId, user);
    await getDb()
      .update(itemRequestItems)
      .set({ is_inventoriable: input.is_inventoriable })
      .where(eq(itemRequestItems.id, itemId));
    await publishRequestChanged({ type: "item", action: "updated", id: request.id, department: request.department });
  });
}

export async function setItemCatalogLinkAction(itemId: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["pending_item_entry"]);
    assertId(itemId, "item ID");
    const name = optionalString(asRecord(value), "catalog_item_name", 255, "Item Catalog name");

    const { request } = await loadRequestItemForClassification(itemId, user);
    await getDb()
      .update(itemRequestItems)
      .set({ catalog_item_name: name ? name.toUpperCase() : null })
      .where(eq(itemRequestItems.id, itemId));
    await publishRequestChanged({ type: "item", action: "updated", id: request.id, department: request.department });
  });
}

// ---------------------------------------------------------------------------
// F-ACC-003 Payment Request Form for an Item Request.
// ---------------------------------------------------------------------------

const FORM_VIEW_PERMISSIONS = ["urgent_items", "submitted_payment_requests", "ap_officer_dashboard"];
const FORM_EDIT_PERMISSIONS = ["urgent_items", "ap_officer_dashboard"];

export async function getItemPaymentRequestFormAction(requestId: number): Promise<ActionResult<ItemPaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, FORM_VIEW_PERMISSIONS);
    assertId(requestId, "request ID");
    return (await readPaymentRequestForm("item", requestId, user)) as ItemPaymentRequestForm;
  });
}

export async function saveItemPaymentRequestFormAction(
  requestId: number,
  value: unknown
): Promise<ActionResult<ItemPaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, FORM_EDIT_PERMISSIONS);
    assertId(requestId, "request ID");
    const { department } = await savePaymentRequestForm("item", requestId, value, user);
    await publishRequestChanged({ type: "item", action: "updated", id: requestId, department });
    return (await readPaymentRequestForm("item", requestId, user)) as ItemPaymentRequestForm;
  });
}

export async function submitItemPaymentRequestFormAction(requestId: number): Promise<ActionResult<ItemPaymentRequestForm>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["urgent_items"]);
    assertId(requestId, "request ID");
    const { department } = await submitPaymentRequestForm("item", requestId, user);
    await publishRequestChanged({ type: "item", action: "updated", id: requestId, department });
    return (await readPaymentRequestForm("item", requestId, user)) as ItemPaymentRequestForm;
  });
}

export async function getSubmittedItemPaymentRequestsAction(): Promise<ActionResult<SubmittedPaymentRequest[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["submitted_payment_requests"]);
    return listSubmittedPaymentRequests("item", user);
  });
}
