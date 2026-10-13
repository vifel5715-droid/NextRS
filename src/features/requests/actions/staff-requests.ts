"use server";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { ItemRequest, ServiceRequest } from "@/types";
import { getItemBalance } from "@/lib/utils/itemBalance";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  itemRequestItems,
  itemRequests,
  serviceItems,
  serviceRequests,
  users,
} from "@/db/schema";

export interface StaffRequestsResult {
  itemRequests: ItemRequest[];
  serviceRequests: ServiceRequest[];
}

export async function getStaffRequestsAction(): Promise<StaffRequestsResult> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("create_request")) throw new Error("Permission denied.");

  const role = user.role.trim().toLowerCase();
  const canViewAllRequests = role === "supervisor" || role === "manager";
  const db = getDb();
  const [itemHeaders, serviceHeaders] = await Promise.all([
    db
      .select({
        id: itemRequests.id,
        serial: itemRequests.serial,
        created_at: itemRequests.created_at,
        created_by: itemRequests.created_by,
        requested_by: itemRequests.requested_by,
        department: itemRequests.department,
        purpose: itemRequests.purpose,
        remarks: itemRequests.remarks,
        status: itemRequests.status,
        supervisor_status: itemRequests.supervisor_status,
        supervisor_approved_by: itemRequests.supervisor_approved_by,
        supervisor_approved_at: itemRequests.supervisor_approved_at,
        custodian_status: itemRequests.custodian_status,
        custodian_approved_by: itemRequests.custodian_approved_by,
        custodian_approved_at: itemRequests.custodian_approved_at,
        rejection_comment: itemRequests.rejection_comment,
        request_type: itemRequests.request_type,
        attachment: itemRequests.attachment,
        attachment_name: itemRequests.attachment_name,
      })
      .from(itemRequests)
      .where(
        canViewAllRequests
          ? undefined
          : and(
              eq(itemRequests.department, user.department),
              or(
                eq(itemRequests.requested_by, user.name),
                and(isNull(itemRequests.requested_by), eq(itemRequests.created_by, user.id))
              )
            )
      )
      .orderBy(desc(itemRequests.created_at)),
    db
      .select({
        id: serviceRequests.id,
        serial: serviceRequests.serial,
        created_at: serviceRequests.created_at,
        created_by: serviceRequests.created_by,
        requested_by: serviceRequests.requested_by,
        department: serviceRequests.department,
        purpose: serviceRequests.purpose,
        remarks: serviceRequests.remarks,
        status: serviceRequests.status,
        supervisor_status: serviceRequests.supervisor_status,
        supervisor_approved_by: serviceRequests.supervisor_approved_by,
        supervisor_approved_at: serviceRequests.supervisor_approved_at,
        custodian_status: serviceRequests.custodian_status,
        custodian_approved_by: serviceRequests.custodian_approved_by,
        custodian_approved_at: serviceRequests.custodian_approved_at,
        rejection_comment: serviceRequests.rejection_comment,
        pr_number: serviceRequests.pr_number,
        pr_status: serviceRequests.pr_status,
      })
      .from(serviceRequests)
      .where(
        canViewAllRequests
          ? undefined
          : and(
              eq(serviceRequests.department, user.department),
              or(
                eq(serviceRequests.requested_by, user.name),
                and(isNull(serviceRequests.requested_by), eq(serviceRequests.created_by, user.id))
              )
            )
      )
      .orderBy(desc(serviceRequests.created_at)),
  ]);

  const itemIds = itemHeaders.map((request) => request.id);
  const serviceIds = serviceHeaders.map((request) => request.id);
  const [itemLines, serviceLines, creators] = await Promise.all([
    itemIds.length
      ? db
          .select()
          .from(itemRequestItems)
          .where(inArray(itemRequestItems.request_id, itemIds))
      : Promise.resolve([]),
    serviceIds.length
      ? db
          .select()
          .from(serviceItems)
          .where(inArray(serviceItems.service_request_id, serviceIds))
      : Promise.resolve([]),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        inArray(
          users.id,
          // Approvers too: their role tells the status badge whether a
          // Supervisor or a Manager signed the shared approval stage.
          [
            ...new Set(
              [...itemHeaders, ...serviceHeaders]
                .flatMap((request) => [request.created_by, request.supervisor_approved_by])
                .filter((id): id is string => !!id)
            ),
          ]
        )
      ),
  ]);

  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
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
    const items = itemLinesByRequest.get(request.id) ?? [];
    const heldItems = items.filter((item) => item.delivery_status === "HOLD");
    const creator = creatorById.get(request.created_by);
    const allItemsServed =
      items.length > 0 &&
      items.every((item) => (item.quantity_out ?? 0) >= item.quantity);

    return {
      ...request,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      remarks: request.remarks ?? "",
      requested_by: request.requested_by ?? creator?.name,
      supervisor_status: request.supervisor_status ?? undefined,
      supervisor_approved_by_role: request.supervisor_approved_by
        ? creatorById.get(request.supervisor_approved_by)?.role
        : undefined,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
      custodian_status: request.custodian_status ?? undefined,
      custodian_approved_at: request.custodian_approved_at ?? undefined,
      rejection_comment: request.rejection_comment ?? undefined,
      attachment: request.attachment ?? undefined,
      attachment_name: request.attachment_name ?? undefined,
      all_items_served: allItemsServed,
      has_held_item: heldItems.length > 0,
      held_item_count: heldItems.length,
      has_edited_held_item: heldItems.some((item) => item.hold_edited),
      pr_numbers: [...new Set(items.map((item) => item.pr_number).filter((value): value is string => !!value))].join(" "),
      items: items.map((item) => ({
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
        qty_balance: getItemBalance(item),
        hold_edited: item.hold_edited,
      })),
    };
  });

  const mappedServiceRequests: ServiceRequest[] = serviceHeaders.map((request) => {
    const creator = creatorById.get(request.created_by);
    return {
      ...request,
      created_by: creator?.name ?? request.created_by,
      created_by_role: creator?.role,
      remarks: request.remarks ?? "",
      requested_by: request.requested_by ?? creator?.name,
      supervisor_status: request.supervisor_status ?? undefined,
      supervisor_approved_by_role: request.supervisor_approved_by
        ? creatorById.get(request.supervisor_approved_by)?.role
        : undefined,
      supervisor_approved_at: request.supervisor_approved_at ?? undefined,
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
        hold_edited: service.hold_edited,
      })),
    };
  });

  return {
    itemRequests: mappedItemRequests.filter((request) => !request.all_items_served),
    serviceRequests: mappedServiceRequests.filter((request) => request.pr_status !== "finish"),
  };
}
