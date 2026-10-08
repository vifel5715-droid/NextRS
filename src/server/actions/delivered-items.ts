"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { DeliveredItem } from "@services/api";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemIssuanceAudits } from "../db/schema";
import { getRequestListsAction } from "./request-lists";

const DELIVERED_STATUSES = new Set(["DELIVERED", "PARTIAL DELIVERED"]);

export async function getDeliveredItemsAction(): Promise<DeliveredItem[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("delivered_items")) throw new Error("Permission denied.");

  const { itemRequests } = await getRequestListsAction();
  const deliveredRequests = itemRequests
    .map((request) => ({
      request,
      items: (request.items ?? []).filter((item) =>
        DELIVERED_STATUSES.has(item.delivery_status?.toUpperCase() ?? "")
      ),
    }))
    .filter(({ items }) => items.length > 0);

  const itemIds = deliveredRequests.flatMap(({ items }) =>
    items.flatMap((item) => (item.id === undefined ? [] : [item.id]))
  );
  const audits = itemIds.length
    ? await getDb()
        .select({
          item_id: itemIssuanceAudits.item_request_item_id,
          issued_at: itemIssuanceAudits.issued_at,
        })
        .from(itemIssuanceAudits)
        .where(
          and(
            inArray(itemIssuanceAudits.item_request_item_id, itemIds),
            eq(itemIssuanceAudits.transaction_type, "PARTIAL")
          )
        )
        .orderBy(desc(itemIssuanceAudits.issued_at))
    : [];

  const latestReceivedAt = new Map<number, string>();
  for (const audit of audits) {
    if (!latestReceivedAt.has(audit.item_id)) {
      latestReceivedAt.set(audit.item_id, audit.issued_at);
    }
  }

  return deliveredRequests.map(({ request, items }) => ({
    id: request.id,
    serial: request.serial,
    purpose: request.purpose,
    status: request.status,
    supervisor_status: request.supervisor_status ?? null,
    custodian_status: request.custodian_status ?? null,
    created_at: request.created_at,
    items: items.map((item) => ({
      item_name: item.item_name,
      delivery_status: item.delivery_status ?? null,
      pr_status: item.pr_status ?? null,
      pr_type: item.pr_type ?? null,
      pr_number: item.pr_number ?? null,
      quantity: item.quantity,
      quantity_delivered: item.quantity_delivered ?? null,
      quantity_out: item.quantity_out ?? null,
      is_partial: (item.quantity_delivered ?? 0) < item.quantity,
      machine_code: item.machine_code ?? null,
      date_received: item.id === undefined ? null : latestReceivedAt.get(item.id) ?? null,
    })),
  }));
}
