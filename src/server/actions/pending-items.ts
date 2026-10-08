"use server";

import { asc, desc, eq, inArray } from "drizzle-orm";
import type { PendingItem } from "../../services/api";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemRequestItems, itemRequests } from "../db/schema";

const GLOBAL_PENDING_ITEM_ROLES = new Set([
  "admin",
  "custodian",
  "director",
  "purchaser",
  "ap_officer",
  "operations_manager",
]);
const PURCHASE_STATUSES = new Set(["PURCHASE REQUEST", "URGENT", "PARTIAL DELIVERED"]);

export async function getPendingItemsAction(): Promise<PendingItem[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("pending_items_services")) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  const scopedRequests = await db
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
    .where(
      GLOBAL_PENDING_ITEM_ROLES.has(user.role.toLowerCase())
        ? undefined
        : eq(itemRequests.department, user.department)
    )
    .orderBy(desc(itemRequests.created_at));

  if (scopedRequests.length === 0) return [];

  const itemRows = await db
    .select({
      request_id: itemRequestItems.request_id,
      item_name: itemRequestItems.item_name,
      delivery_status: itemRequestItems.delivery_status,
      pr_type: itemRequestItems.pr_type,
      pr_number: itemRequestItems.pr_number,
      pr_status: itemRequestItems.pr_status,
      quantity: itemRequestItems.quantity,
      quantity_delivered: itemRequestItems.quantity_delivered,
      machine_code: itemRequestItems.machine_code,
      id: itemRequestItems.id,
    })
    .from(itemRequestItems)
    .where(inArray(itemRequestItems.request_id, scopedRequests.map((request) => request.id)))
    .orderBy(asc(itemRequestItems.id));

  const requestsWithPendingPurchaseItems = new Map<number, PendingItem>();
  const requestsById = new Map(scopedRequests.map((request) => [request.id, request]));

  for (const item of itemRows) {
    const request = requestsById.get(item.request_id);
    if (!request) continue;

    const status = item.delivery_status?.toUpperCase() ?? "";
    const purchaseType = (item.pr_type ?? status).toUpperCase();
    const partialQuantity = Math.max(0, item.quantity - (item.quantity_delivered ?? 0));
    if (
      !PURCHASE_STATUSES.has(status) ||
      !["PURCHASE REQUEST", "URGENT"].includes(purchaseType) ||
      item.pr_status?.toLowerCase() === "finish" ||
      partialQuantity === 0
    ) {
      continue;
    }

    let pendingRequest = requestsWithPendingPurchaseItems.get(request.id);
    if (!pendingRequest) {
      pendingRequest = {
        ...request,
        status: request.status,
        supervisor_status: request.supervisor_status,
        custodian_status: request.custodian_status,
        items: [],
      };
      requestsWithPendingPurchaseItems.set(request.id, pendingRequest);
    }

    pendingRequest.items.push({
      item_name: item.item_name,
      delivery_status: item.delivery_status,
      pr_number: item.pr_number,
      partial_qty: partialQuantity,
      machine_code: item.machine_code,
    });
  }

  return [...requestsWithPendingPurchaseItems.values()];
}
