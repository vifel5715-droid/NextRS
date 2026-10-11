"use server";

import { and, desc, eq, getTableColumns, inArray, isNull, or } from "drizzle-orm";
import type { ReimbursementRequest, UrgentRequest } from "@shared/types";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import {
  reimbursementItems,
  reimbursementRequests,
  urgentRequestItems,
  urgentRequests,
  users,
} from "../db/schema";

const GLOBAL_REQUEST_ROLES = new Set(["admin", "operations_manager", "purchaser", "ap_officer"]);

function canViewRequests(
  permissions: string[],
  allowedPermissions: readonly string[]
): boolean {
  return allowedPermissions.some((permission) => permissions.includes(permission));
}

function isGlobalRequestUser(role: string): boolean {
  return GLOBAL_REQUEST_ROLES.has(role.toLowerCase());
}

export async function getUrgentRequestsAction(): Promise<UrgentRequest[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (
    !canViewRequests(user.permissions, [
      "create_request",
      "urgent_items",
      "supervisor_dashboard",
      "purchaser_dashboard",
    ])
  ) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  const scopedReviewer = canViewRequests(user.permissions, [
    "urgent_items",
    "supervisor_dashboard",
    "purchaser_dashboard",
  ]);
  const scope = isGlobalRequestUser(user.role)
    ? undefined
    : scopedReviewer
      ? eq(urgentRequests.department, user.department)
      : and(
          eq(urgentRequests.department, user.department),
          or(
            eq(urgentRequests.requested_by, user.name),
            and(isNull(urgentRequests.requested_by), eq(urgentRequests.created_by, user.id))
          )
        );

  const headers = await db
    .select()
    .from(urgentRequests)
    .where(scope)
    .orderBy(desc(urgentRequests.created_at));
  const ids = headers.map((request) => request.id);
  const items = ids.length
    ? await db.select().from(urgentRequestItems).where(inArray(urgentRequestItems.request_id, ids))
    : [];
  const actorIds = [
    ...new Set(
      [
        ...headers.flatMap((request) => [
          request.created_by,
          request.supervisor_approved_by,
          request.stockroom_approved_by,
        ]),
        ...items.map((item) => item.delivered_by),
      ].filter((id): id is string => id !== null)
    ),
  ];
  const actors = actorIds.length
    ? await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
  const itemsByRequest = new Map<number, typeof items>();
  for (const item of items) {
    const requestItems = itemsByRequest.get(item.request_id) ?? [];
    requestItems.push(item);
    itemsByRequest.set(item.request_id, requestItems);
  }

  return headers.map((request) => {
    const creator = actorsById.get(request.created_by);
    return {
      ...request,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      requested_by: request.requested_by ?? creator?.name,
      supervisor_approved_by_name: request.supervisor_approved_by
        ? actorsById.get(request.supervisor_approved_by)?.name
        : undefined,
      supervisor_approved_by_role: request.supervisor_approved_by
        ? actorsById.get(request.supervisor_approved_by)?.role
        : undefined,
      stockroom_approved_by_name: request.stockroom_approved_by
        ? actorsById.get(request.stockroom_approved_by)?.name
        : undefined,
      supervisor_status: request.supervisor_status as UrgentRequest["supervisor_status"],
      stockroom_status: request.stockroom_status as UrgentRequest["stockroom_status"],
      remarks: request.remarks ?? undefined,
      date_needed: request.date_needed ?? undefined,
      supervisor_approved_by: request.supervisor_approved_by ?? undefined,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
      stockroom_approved_by: request.stockroom_approved_by ?? undefined,
      stockroom_approved_at: request.stockroom_approved_at ?? undefined,
      rejection_comment: request.rejection_comment ?? undefined,
      items: (itemsByRequest.get(request.id) ?? []).map((item) => ({
        id: item.id,
        item_description: item.item_description,
        quantity: item.quantity ?? undefined,
        uom: item.uom ?? undefined,
        is_inventoriable: item.is_inventoriable,
        purchasing_transaction: item.purchasing_transaction as
          | "purchase_order"
          | "payment_request"
          | null
          | undefined,
        amount: item.amount ?? undefined,
        delivery_status: item.delivery_status as
          | "pending"
          | "delivered"
          | "partial_delivered",
        quantity_delivered: item.quantity_delivered,
        delivered_by: item.delivered_by,
        delivered_by_name: item.delivered_by
          ? actorsById.get(item.delivered_by)?.name
          : undefined,
        delivered_at: item.delivered_at,
        catalog_item_name: item.catalog_item_name,
      })),
    };
  });
}

export async function getReimbursementRequestsAction(): Promise<ReimbursementRequest[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (
    !canViewRequests(user.permissions, [
      "create_request",
      "supervisor_dashboard",
      "purchaser_dashboard",
      "ap_officer_dashboard",
    ])
  ) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  const scopedReviewer = canViewRequests(user.permissions, [
    "supervisor_dashboard",
    "purchaser_dashboard",
    "ap_officer_dashboard",
  ]);
  const scope = isGlobalRequestUser(user.role)
    ? undefined
    : scopedReviewer
      ? eq(reimbursementRequests.department, user.department)
      : and(
          eq(reimbursementRequests.department, user.department),
          or(
            eq(reimbursementRequests.requested_by, user.name),
            and(
              isNull(reimbursementRequests.requested_by),
              eq(reimbursementRequests.created_by, user.id)
            )
          )
        );

  const { attachment_data: _attachmentData, ...headerColumns } =
    getTableColumns(reimbursementRequests);
  const headers = await db
    .select(headerColumns)
    .from(reimbursementRequests)
    .where(scope)
    .orderBy(desc(reimbursementRequests.created_at));
  const ids = headers.map((request) => request.id);
  const items = ids.length
    ? await db.select().from(reimbursementItems).where(inArray(reimbursementItems.request_id, ids))
    : [];
  const actorIds = [
    ...new Set(
      headers.flatMap((request) => [
        request.created_by,
        request.supervisor_approved_by,
        request.purchaser_approved_by,
        request.ap_approved_by,
        request.closed_by,
      ]).filter((id): id is string => id !== null)
    ),
  ];
  const actors = actorIds.length
    ? await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
  const itemsByRequest = new Map<number, typeof items>();
  for (const item of items) {
    const requestItems = itemsByRequest.get(item.request_id) ?? [];
    requestItems.push(item);
    itemsByRequest.set(item.request_id, requestItems);
  }

  return headers.map((request) => {
    const creator = actorsById.get(request.created_by);
    const requestItems = itemsByRequest.get(request.id) ?? [];
    return {
      ...request,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      requested_by: request.requested_by ?? creator?.name,
      remarks: request.remarks ?? undefined,
      date_needed: request.date_needed ?? undefined,
      attachment_name: request.attachment_name ?? undefined,
      attachment_size: request.attachment_size ?? undefined,
      supervisor_status: request.supervisor_status as ReimbursementRequest["supervisor_status"],
      purchaser_status: request.purchaser_status as ReimbursementRequest["purchaser_status"],
      ap_status: request.ap_status as ReimbursementRequest["ap_status"],
      supervisor_approved_by_name: request.supervisor_approved_by
        ? actorsById.get(request.supervisor_approved_by)?.name
        : undefined,
      supervisor_approved_by_role: request.supervisor_approved_by
        ? actorsById.get(request.supervisor_approved_by)?.role
        : undefined,
      purchaser_approved_by_name: request.purchaser_approved_by
        ? actorsById.get(request.purchaser_approved_by)?.name
        : undefined,
      ap_approved_by_name: request.ap_approved_by
        ? actorsById.get(request.ap_approved_by)?.name
        : undefined,
      supervisor_approved_by: request.supervisor_approved_by ?? undefined,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
      purchaser_approved_by: request.purchaser_approved_by ?? undefined,
      purchaser_approved_at: request.purchaser_approved_at ?? undefined,
      ap_approved_by: request.ap_approved_by ?? undefined,
      ap_approved_at: request.ap_approved_at ?? undefined,
      closed_by: request.closed_by ?? undefined,
      closed_at: request.closed_at ?? undefined,
      rejection_comment: request.rejection_comment ?? undefined,
      items: requestItems.map((item) => ({
        id: item.id,
        item_description: item.item_description,
        quantity: item.quantity ?? undefined,
        uom: item.uom ?? undefined,
        amount: item.amount,
      })),
      total_cost: requestItems
        .reduce((total, item) => total + Number(item.amount), 0)
        .toFixed(2),
    };
  });
}
