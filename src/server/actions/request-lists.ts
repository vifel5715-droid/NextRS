"use server";

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { ItemRequest, ServiceRequest } from "@shared/types";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemRequestItems, itemRequests, serviceItems, serviceRequests, users } from "../db/schema";

export interface RequestListsResult {
  itemRequests: ItemRequest[];
  serviceRequests: ServiceRequest[];
}

type RequestScope = "all" | "own";
const GLOBAL_REQUEST_ROLES = new Set([
  "admin",
  "custodian",
  "director",
  "purchaser",
  "ap_officer",
  "operations_manager",
]);

async function loadRequestLists(
  scope: RequestScope,
  allowOverview = false
): Promise<RequestListsResult> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");

  const hasBroadListPermission =
    user.permissions.includes("department_requests") ||
    user.permissions.includes("supervisor_dashboard");
  const hasOwnListPermission =
    user.permissions.includes("create_request") ||
    user.permissions.includes("complete_requests") ||
    user.permissions.includes("pending_items_services") ||
    (allowOverview && user.permissions.includes("overview"));

  if (!hasBroadListPermission && !hasOwnListPermission) {
    throw new Error("Permission denied.");
  }

  const db = getDb();
  const role = user.role.toLowerCase();
  const globalScope = scope === "all" && GLOBAL_REQUEST_ROLES.has(role);
  const ownScope = scope === "own" || (!globalScope && !hasBroadListPermission);
  const departmentScope = !globalScope && !ownScope && hasBroadListPermission;
  const [itemHeaders, serviceHeaders] = await Promise.all([
    db
      .select()
      .from(itemRequests)
      .where(
        ownScope
          ? and(
              eq(itemRequests.department, user.department),
              or(
                eq(itemRequests.requested_by, user.name),
                and(isNull(itemRequests.requested_by), eq(itemRequests.created_by, user.id))
              )
            )
        : departmentScope
          ? eq(itemRequests.department, user.department)
          : undefined
      )
      .orderBy(desc(itemRequests.created_at)),
    db
      .select()
      .from(serviceRequests)
      .where(
        ownScope
          ? and(
              eq(serviceRequests.department, user.department),
              or(
                eq(serviceRequests.requested_by, user.name),
                and(isNull(serviceRequests.requested_by), eq(serviceRequests.created_by, user.id))
              )
            )
          : departmentScope
            ? eq(serviceRequests.department, user.department)
            : undefined
      )
      .orderBy(desc(serviceRequests.created_at)),
  ]);

  const itemIds = itemHeaders.map((request) => request.id);
  const serviceIds = serviceHeaders.map((request) => request.id);
  const [itemLines, serviceLines] = await Promise.all([
    itemIds.length
      ? db
          .select()
          .from(itemRequestItems)
          .where(inArray(itemRequestItems.request_id, itemIds))
          .orderBy(asc(itemRequestItems.id))
      : Promise.resolve([]),
    serviceIds.length
      ? db
          .select()
          .from(serviceItems)
          .where(inArray(serviceItems.service_request_id, serviceIds))
          .orderBy(asc(serviceItems.id))
      : Promise.resolve([]),
  ]);

  const referencedUserIds = [
    ...new Set(
      [
        ...itemHeaders.flatMap((request) => [
          request.created_by,
          request.supervisor_approved_by,
          request.custodian_approved_by,
        ]),
        ...serviceHeaders.flatMap((request) => [
          request.created_by,
          request.supervisor_approved_by,
          request.custodian_approved_by,
        ]),
        ...serviceLines.map((service) => service.receiving_report_no_updated_by),
      ].filter((id): id is string => Boolean(id))
    ),
  ];
  const people = referencedUserIds.length
    ? await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(inArray(users.id, referencedUserIds))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const itemLinesByRequest = new Map<number, typeof itemLines>();
  for (const item of itemLines) {
    const lines = itemLinesByRequest.get(item.request_id) ?? [];
    lines.push(item);
    itemLinesByRequest.set(item.request_id, lines);
  }
  const serviceLinesByRequest = new Map<number, typeof serviceLines>();
  for (const service of serviceLines) {
    const lines = serviceLinesByRequest.get(service.service_request_id) ?? [];
    lines.push(service);
    serviceLinesByRequest.set(service.service_request_id, lines);
  }

  const mappedItemRequests: ItemRequest[] = itemHeaders.map((request) => {
    const lines = itemLinesByRequest.get(request.id) ?? [];
    const creator = peopleById.get(request.created_by);
    const supervisor = request.supervisor_approved_by
      ? peopleById.get(request.supervisor_approved_by)
      : undefined;
    const custodian = request.custodian_approved_by
      ? peopleById.get(request.custodian_approved_by)
      : undefined;
    const heldLines = lines.filter((item) => item.delivery_status === "HOLD");

    return {
      id: request.id,
      serial: request.serial,
      created_at: request.created_at,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      requested_by: request.requested_by ?? creator?.name,
      department: request.department,
      purpose: request.purpose,
      remarks: request.remarks ?? "",
      status: request.status,
      supervisor_status: request.supervisor_status ?? undefined,
      supervisor_name: supervisor?.name,
      supervisor_approved_by_name: supervisor?.name,
      supervisor_approved_by_role: supervisor?.role,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
      custodian_name: custodian?.name,
      custodian_approved_by_name: custodian?.name,
      custodian_approved_by_role: custodian?.role,
      custodian_status: request.custodian_status ?? undefined,
      custodian_approved_at: request.custodian_approved_at ?? undefined,
      rejection_comment: request.rejection_comment ?? undefined,
      attachment: request.attachment ?? undefined,
      attachment_name: request.attachment_name ?? undefined,
      all_items_served:
        lines.length > 0 && lines.every((item) => (item.quantity_out ?? 0) >= item.quantity),
      has_held_item: heldLines.length > 0,
      held_item_count: heldLines.length,
      has_edited_held_item: heldLines.some((item) => item.hold_edited),
      pr_numbers: [
        ...new Set(lines.map((item) => item.pr_number).filter((number): number is string => Boolean(number))),
      ].join(" "),
      items: lines.map((item) => ({
        id: item.id,
        item_name: item.item_name,
        quantity: item.quantity,
        uom: item.uom,
        remarks: item.remarks ?? "",
        machine_code: item.machine_code ?? undefined,
        delivery_status: item.delivery_status ?? undefined,
        pr_number: item.pr_number ?? undefined,
        pr_status: item.pr_status ?? undefined,
        pr_type: item.pr_type ?? undefined,
        date_needed: item.date_needed,
        issuance_number: item.issuance_number ?? undefined,
        quantity_delivered: item.quantity_delivered ?? undefined,
        quantity_out: item.quantity_out ?? undefined,
        qty_balance: item.qty_balance,
        hold_edited: item.hold_edited,
        purchasing_transaction: item.purchasing_transaction,
        amount: item.amount,
        is_inventoriable: item.is_inventoriable,
        catalog_item_name: item.catalog_item_name,
      })),
    };
  });

  const mappedServiceRequests: ServiceRequest[] = serviceHeaders.map((request) => {
    const creator = peopleById.get(request.created_by);
    const supervisor = request.supervisor_approved_by
      ? peopleById.get(request.supervisor_approved_by)
      : undefined;
    const custodian = request.custodian_approved_by
      ? peopleById.get(request.custodian_approved_by)
      : undefined;

    return {
      id: request.id,
      serial: request.serial,
      created_at: request.created_at,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      requested_by: request.requested_by ?? creator?.name,
      department: request.department,
      purpose: request.purpose,
      remarks: request.remarks ?? "",
      status: request.status,
      supervisor_status: request.supervisor_status ?? undefined,
      supervisor_name: supervisor?.name,
      supervisor_approved_by_name: supervisor?.name,
      supervisor_approved_by_role: supervisor?.role,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
      custodian_name: custodian?.name,
      custodian_approved_by_name: custodian?.name,
      custodian_approved_by_role: custodian?.role,
      custodian_status: request.custodian_status ?? undefined,
      custodian_approved_at: request.custodian_approved_at ?? undefined,
      rejection_comment: request.rejection_comment ?? undefined,
      pr_number: request.pr_number ?? undefined,
      pr_status: request.pr_status ?? undefined,
      services: (serviceLinesByRequest.get(request.id) ?? []).map((service) => ({
        id: service.id,
        description: service.description,
        delivery_status: service.delivery_status ?? undefined,
        pr_number: service.pr_number ?? undefined,
        pr_status: service.pr_status ?? undefined,
        receiving_report_no: service.receiving_report_no ?? undefined,
        receiving_report_no_updated_by_name: service.receiving_report_no_updated_by
          ? peopleById.get(service.receiving_report_no_updated_by)?.name
          : undefined,
        receiving_report_no_updated_at: service.receiving_report_no_updated_at ?? undefined,
        hold_edited: service.hold_edited,
      })),
    };
  });

  return { itemRequests: mappedItemRequests, serviceRequests: mappedServiceRequests };
}

export async function getRequestListsAction(): Promise<RequestListsResult> {
  return loadRequestLists("all");
}

export async function getMyRequestListsAction(): Promise<RequestListsResult> {
  return loadRequestLists("own");
}

export interface DashboardRequestCounts {
  completeRequestsCount: number;
  heldItemsCount: number;
  totalRequestsCount: number;
}

function isValidTimestamp(value: string | undefined): boolean {
  if (value === undefined) return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export async function getDashboardRequestCountsAction(
  startAt?: string,
  endAt?: string
): Promise<DashboardRequestCounts> {
  if (!isValidTimestamp(startAt) || !isValidTimestamp(endAt)) {
    throw new Error("Invalid date range.");
  }
  if (startAt && endAt && startAt > endAt) {
    throw new Error("Start date must not be after end date.");
  }

  const { itemRequests, serviceRequests } = await loadRequestLists("all", true);
  const inRange = (createdAt: string) => {
    const timestamp = new Date(createdAt).getTime();
    return (
      Number.isFinite(timestamp) &&
      (!startAt || timestamp >= Date.parse(startAt)) &&
      (!endAt || timestamp <= Date.parse(endAt))
    );
  };
  const itemsInRange = startAt || endAt
    ? itemRequests.filter((request) => inRange(request.created_at))
    : itemRequests;
  const servicesInRange = startAt || endAt
    ? serviceRequests.filter((request) => inRange(request.created_at))
    : serviceRequests;
  const completeItems = itemsInRange.filter((request) => request.all_items_served);
  const completeServices = servicesInRange.filter((request) => request.pr_status === "finish");

  return {
    completeRequestsCount: completeItems.length + completeServices.length,
    heldItemsCount: itemsInRange.filter(
      (request) => !request.all_items_served && request.has_held_item
    ).length,
    totalRequestsCount:
      itemsInRange.filter((request) => !request.all_items_served).length +
      servicesInRange.filter((request) => request.pr_status !== "finish").length,
  };
}
