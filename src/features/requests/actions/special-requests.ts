"use server";

import { desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { ReimbursementRequest, UrgentRequest } from "@/types";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { isUnscopedRole } from "@/lib/permissions";
import {
  reimbursementItems,
  reimbursementRequests,
  urgentRequestItems,
  urgentRequests,
  users,
} from "@/db/schema";

function canViewRequests(
  permissions: string[],
  allowedPermissions: readonly string[]
): boolean {
  return allowedPermissions.some((permission) => permissions.includes(permission));
}

// Who may list each request type — shared by the list actions and the
// dashboard counts below so the two can never disagree.
const URGENT_VIEW_PERMISSIONS = ["create_request", "urgent_items", "supervisor_dashboard", "purchaser_dashboard"] as const;
const REIMBURSEMENT_VIEW_PERMISSIONS = ["create_request", "supervisor_dashboard", "purchaser_dashboard", "ap_officer_dashboard"] as const;

function isGlobalRequestUser(role: string): boolean {
  return isUnscopedRole(role.trim().toLowerCase());
}

export async function getUrgentRequestsAction(): Promise<UrgentRequest[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (
    !canViewRequests(user.permissions, URGENT_VIEW_PERMISSIONS)
  ) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  // Every request from the user's own department; global roles see all.
  const scope = isGlobalRequestUser(user.role) ? undefined : eq(sql`upper(trim(${urgentRequests.department}))`, user.department.trim().toUpperCase());

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
    !canViewRequests(user.permissions, REIMBURSEMENT_VIEW_PERMISSIONS)
  ) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  // Every request from the user's own department; global roles see all.
  const scope = isGlobalRequestUser(user.role) ? undefined : eq(sql`upper(trim(${reimbursementRequests.department}))`, user.department.trim().toUpperCase());

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

export interface VisibleSpecialRequests {
  /** null when the user can't list urgent requests at all. */
  urgent: UrgentRequest[] | null;
  /** null when the user can't list reimbursement requests at all. */
  reimbursement: ReimbursementRequest[] | null;
}

/**
 * Both special request lists, each only when this user may list it — so
 * pages that show every request type (Dashboard summary, Summary Requests)
 * skip a type the user can't see instead of failing outright.
 */
export async function getVisibleSpecialRequestsAction(): Promise<VisibleSpecialRequests> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  const [urgent, reimbursement] = await Promise.all([
    canViewRequests(user.permissions, URGENT_VIEW_PERMISSIONS) ? getUrgentRequestsAction() : null,
    canViewRequests(user.permissions, REIMBURSEMENT_VIEW_PERMISSIONS) ? getReimbursementRequestsAction() : null,
  ]);
  return { urgent, reimbursement };
}

export interface SpecialRequestCounts {
  /** null when the user can't list urgent requests at all. */
  urgentCount: number | null;
  /** null when the user can't list reimbursement requests at all. */
  reimbursementCount: number | null;
}

/**
 * Dashboard "All Requests Summary" — how many urgent and reimbursement
 * requests the user can see, created within the given ISO range. Goes
 * through the same list actions (and so the same role/department scoping)
 * as the Urgent and Reimbursement tabs.
 */
export async function getSpecialRequestCountsAction(
  startAt?: string,
  endAt?: string
): Promise<SpecialRequestCounts> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  const start = startAt ? Date.parse(startAt) : undefined;
  const end = endAt ? Date.parse(endAt) : undefined;
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Invalid date range.");
  const inRange = (createdAt: string) => {
    const timestamp = new Date(createdAt).getTime();
    return (
      Number.isFinite(timestamp) &&
      (start === undefined || timestamp >= start) &&
      (end === undefined || timestamp <= end)
    );
  };

  const { urgent, reimbursement } = await getVisibleSpecialRequestsAction();
  return {
    urgentCount: urgent ? urgent.filter((request) => inRange(request.created_at)).length : null,
    reimbursementCount: reimbursement ? reimbursement.filter((request) => inRange(request.created_at)).length : null,
  };
}
