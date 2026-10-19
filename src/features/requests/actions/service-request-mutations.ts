"use server";

import { eq, inArray } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser, type AuthorizedUser } from "@/lib/auth";
import {
  isHoldResolver,
  assertCanEditRequest,
  assertServiceFulfillmentEditable,
  isRequestOwner,
  requireDepartmentAccess,
  requirePermission,
} from "@/lib/permissions";
import {
  asRecord,
  assertId,
  optionalString,
  requiredReason,
} from "@/lib/validation";
import { logAdjustments } from "@/server/audit/adjustments";
import { getDb } from "@/lib/db";
import { deletionLog, serviceItems, serviceRequests, users } from "@/db/schema";
import { publishRequestChanged } from "@/lib/realtime";
import { canFinishServiceRequest, SERVICE_FINISH_BLOCKED_MESSAGE } from "@/lib/utils/status";

const SERVICE_STATUSES = new Set(["pending", "holded", "completed"]);
const SERVICE_PR_STATUSES = new Set(["pending", "finish"]);

const isCustodianRole = (user: AuthorizedUser) =>
  ["custodian", "admin", "director", "operations_manager"].includes(user.roleKey);

const sameValue = (a: string | null | undefined, b: string | null | undefined) => (a?.trim() || null) === (b?.trim() || null);

async function loadServiceRequest(id: number) {
  const [request] = await getDb().select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
  if (!request) throw new Error("Request not found.");
  return request;
}

function parsePrNumber(input: Record<string, unknown>): string | null | undefined {
  const value = optionalString(input, "pr_number", 50, "PR Number");
  if (value === undefined) return undefined;
  return value || null;
}

function parsePrStatus(input: Record<string, unknown>): string | null | undefined {
  const value = optionalString(input, "pr_status", 50, "PR Status");
  if (value === undefined) return undefined;
  if (!value) return null;
  if (!SERVICE_PR_STATUSES.has(value.toLowerCase())) throw new Error("Invalid PR Status.");
  return value.toLowerCase();
}

/**
 * Request header + service lines edit. Backs both the requester edit flows
 * (purpose/remarks/services membership) and the custodian "Save Service
 * Updates" flow (PR Number / PR Status). Ported from the legacy
 * updateServiceRequest controller.
 */
export async function updateServiceRequestAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["create_request", "supervisor_dashboard", "department_requests", "held_items", "complete_requests"]);
    assertId(id, "request ID");
    const input = asRecord(value);
    const purpose = optionalString(input, "purpose", 2000);
    if (purpose !== undefined && !purpose) throw new Error("Purpose is required.");
    const remarks = optionalString(input, "remarks", 5000);
    const prNumber = parsePrNumber(input);
    const prStatus = parsePrStatus(input);
    let services: Array<{ id?: number; description: string }> | undefined;
    if (input.services !== undefined) {
      if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 200) {
        throw new Error("A request must contain between 1 and 200 services.");
      }
      services = input.services.map((entry, index) => {
        const service = asRecord(entry, `service #${index + 1}`);
        const description = optionalString(service, "description", 2000, `Service #${index + 1} description`);
        if (!description) throw new Error(`Service #${index + 1}: description cannot be blank.`);
        return {
          id: typeof service.id === "number" && Number.isSafeInteger(service.id) ? service.id : undefined,
          description: description.toUpperCase(),
        };
      });
    }

    const request = await loadServiceRequest(id);

    const changesPurpose = purpose !== undefined && !sameValue(purpose, request.purpose);
    const changesRemarks = remarks !== undefined && !sameValue(remarks, request.remarks);
    const changesPrNumber = prNumber !== undefined && !sameValue(prNumber, request.pr_number);
    const changesPrStatus = prStatus !== undefined && !sameValue(prStatus, request.pr_status);

    // "Save Service Updates" resends the whole header with every save; only
    // an ACTUAL change is checked against who may make it, so a Held Items
    // hand-off (which edits a line, not the header) is a no-op here — even
    // for a Supervisor/Manager resolving another department's held line.
    if (!changesPurpose && !changesRemarks && !changesPrNumber && !changesPrStatus && !services) return;
    requireDepartmentAccess(user, request.department);
    if ((changesPrNumber || changesPrStatus) && !isCustodianRole(user)) {
      throw new Error("Only the custodian can change the PR Number or PR Status.");
    }
    // Checked against the stored approval state, not anything the client sent.
    if (changesPrNumber || changesPrStatus) assertServiceFulfillmentEditable(request);
    if (changesPrStatus && prStatus === "finish") {
      const lines = await getDb()
        .select({ delivery_status: serviceItems.delivery_status, receiving_report_no: serviceItems.receiving_report_no })
        .from(serviceItems)
        .where(eq(serviceItems.service_request_id, id));
      if (!canFinishServiceRequest(lines)) throw new Error(SERVICE_FINISH_BLOCKED_MESSAGE);
    }
    if (changesPurpose || changesRemarks || services) {
      assertCanEditRequest(user, request);
    }

    const now = new Date().toISOString();
    await getDb().transaction(async (tx) => {
      const header: Partial<typeof serviceRequests.$inferInsert> = {};
      if (changesPurpose) header.purpose = purpose!;
      if (changesRemarks) header.remarks = remarks || null;
      if (changesPrNumber) {
        header.pr_number = prNumber;
        // Attribution only moves when the value really changes, so an
        // unrelated save never reassigns "who typed the PR number".
        header.pr_number_updated_by = prNumber ? user.id : null;
        header.pr_number_updated_at = prNumber ? now : null;
      }
      if (changesPrStatus) header.pr_status = prStatus;
      if (Object.keys(header).length > 0) {
        await tx.update(serviceRequests).set(header).where(eq(serviceRequests.id, id));
      }

      if (services) {
        // Only description and membership are owned by these flows; per-line
        // status/RR fields (and their attribution) are left untouched.
        const existing = await tx
          .select({ id: serviceItems.id, description: serviceItems.description, receiving_report_no: serviceItems.receiving_report_no })
          .from(serviceItems)
          .where(eq(serviceItems.service_request_id, id));
        const existingIds = new Set(existing.map((service) => service.id));
        const keptIds = new Set(services.filter((service) => service.id !== undefined && existingIds.has(service.id)).map((service) => service.id!));
        const removed = existing.filter((service) => !keptIds.has(service.id));
        const receipted = removed.find((service) => service.receiving_report_no);
        if (receipted) {
          throw new Error(`"${receipted.description}" already has a Receiving Report No. and cannot be removed.`);
        }
        if (removed.length > 0) {
          await tx.insert(deletionLog).values(
            removed.map((service) => ({
              request_type: "service",
              request_id: id,
              request_serial: request.serial,
              department: request.department,
              entity_name: service.description,
              reason: "Removed while editing the request",
              deleted_by: user.id,
              deleted_at: now,
            }))
          );
          await tx.delete(serviceItems).where(inArray(serviceItems.id, removed.map((service) => service.id)));
        }
        for (const service of services) {
          if (service.id !== undefined && existingIds.has(service.id)) {
            await tx.update(serviceItems).set({ description: service.description }).where(eq(serviceItems.id, service.id));
          } else {
            await tx.insert(serviceItems).values({ service_request_id: id, description: service.description });
          }
        }
      }
    });

    await publishRequestChanged({ type: "service", action: "updated", id, department: request.department });
  });
}

/**
 * One service line: description (Held hand-off), status, and Receiving
 * Report No. Ported from the legacy updateRequestServiceItem.
 */
export async function updateServiceItemAction(serviceId: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "held_items", "complete_requests"]);
    assertId(serviceId, "service ID");
    const input = asRecord(value);
    const description = optionalString(input, "description", 2000);
    if (description !== undefined && !description) throw new Error("Service description cannot be blank.");
    const deliveryStatus = optionalString(input, "delivery_status", 50, "status");
    if (deliveryStatus && !SERVICE_STATUSES.has(deliveryStatus)) throw new Error("Invalid service status.");
    const receivingReportNo = optionalString(input, "receiving_report_no", 100, "Receiving Report No.");
    const prNumber = parsePrNumber(input);
    const prStatus = parsePrStatus(input);
    const adjustmentRemarks = optionalString(input, "adjustment_remarks", 5000) ?? "";

    const result = await getDb().transaction(async (tx) => {
      const [service] = await tx.select().from(serviceItems).where(eq(serviceItems.id, serviceId)).for("update");
      if (!service) throw new Error("Service item not found.");
      const [request] = await tx
        .select({
          id: serviceRequests.id,
          serial: serviceRequests.serial,
          department: serviceRequests.department,
          pr_status: serviceRequests.pr_status,
          created_by: serviceRequests.created_by,
          requested_by: serviceRequests.requested_by,
          supervisor_status: serviceRequests.supervisor_status,
          custodian_status: serviceRequests.custodian_status,
        })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, service.service_request_id))
        .for("update");
      if (!request) throw new Error("Request not found.");

      const changed = {
        description: description !== undefined && !sameValue(description, service.description),
        delivery_status: deliveryStatus !== undefined && !sameValue(deliveryStatus, service.delivery_status ?? "pending"),
        receiving_report_no: receivingReportNo !== undefined && !sameValue(receivingReportNo, service.receiving_report_no),
        pr_number: prNumber !== undefined && !sameValue(prNumber, service.pr_number),
        pr_status: prStatus !== undefined && !sameValue(prStatus, service.pr_status),
      };

      // Staff may fix the description of a Holded line on their own request.
      const staffOwner = user.roleKey === "staff";
      if (isHoldResolver(user) || staffOwner) {
        if (staffOwner) {
          requireDepartmentAccess(user, request.department);
          if (!isRequestOwner(user, request)) throw new Error("You can only correct held services on your own request.");
        }
        // Save Service Updates resends every line; untouched siblings pass.
        if (changed.delivery_status || changed.receiving_report_no || changed.pr_number || changed.pr_status) {
          throw new Error("You can only change the description of a Holded service.");
        }
        if (changed.description && service.delivery_status !== "holded") {
          throw new Error("You can only act on a service that is currently Holded.");
        }
        if (user.roleKey === "secretary") requireDepartmentAccess(user, request.department);
      } else if (!isCustodianRole(user)) {
        throw new Error("Permission denied.");
      }
      if (!Object.values(changed).some(Boolean)) return null;
      // Any real change to a line needs both approvals first (row locked above).
      assertServiceFulfillmentEditable(request);

      const now = new Date().toISOString();
      const patch: Partial<typeof serviceItems.$inferInsert> = {};
      if (changed.description) patch.description = description!.toUpperCase();
      if (changed.delivery_status) {
        patch.delivery_status = deliveryStatus;
        patch.hold_edited = false;
      }
      if (changed.pr_number) patch.pr_number = prNumber;
      if (changed.pr_status) patch.pr_status = prStatus;
      if (changed.receiving_report_no) {
        patch.receiving_report_no = receivingReportNo || null;
        patch.receiving_report_no_updated_by = receivingReportNo ? user.id : null;
        patch.receiving_report_no_updated_at = receivingReportNo ? now : null;
        // Blanking an RR No. undoes the "completed" state it backed.
        if (!receivingReportNo && service.receiving_report_no) patch.delivery_status = "pending";
      }
      if ((isHoldResolver(user) || staffOwner) && service.delivery_status === "holded") patch.hold_edited = true;

      await tx.update(serviceItems).set(patch).where(eq(serviceItems.id, serviceId));

      // PR Status follows the lines: "finish" once every line is completed
      // and has a Receiving Report No.
      if (patch.delivery_status !== undefined || changed.receiving_report_no) {
        const siblings = await tx
          .select({ delivery_status: serviceItems.delivery_status, receiving_report_no: serviceItems.receiving_report_no })
          .from(serviceItems)
          .where(eq(serviceItems.service_request_id, request.id));
        await tx
          .update(serviceRequests)
          .set({ pr_status: canFinishServiceRequest(siblings) ? "finish" : "pending" })
          .where(eq(serviceRequests.id, request.id));
      }

      if (adjustmentRemarks && changed.description) {
        await logAdjustments(tx, {
          user,
          requestId: request.id,
          requestType: "service",
          requestSerial: request.serial,
          department: request.department,
          itemLabel: `Service #${service.id} — ${(patch.description ?? service.description).toUpperCase()}`,
          remarks: adjustmentRemarks,
          changes: [["Description", service.description, patch.description ?? service.description]],
        });
      }
      return request;
    });

    if (result) {
      await publishRequestChanged({ type: "service", action: "updated", id: result.id, department: result.department });
    }
  });
}

export async function deleteServiceItemAction(serviceId: number, reasonInput: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "held_items"]);
    assertId(serviceId, "service ID");
    const reason = requiredReason(reasonInput);

    const request = await getDb().transaction(async (tx) => {
      const [service] = await tx.select().from(serviceItems).where(eq(serviceItems.id, serviceId)).for("update");
      if (!service) throw new Error("Service not found.");
      const [request] = await tx
        .select({ id: serviceRequests.id, serial: serviceRequests.serial, department: serviceRequests.department })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, service.service_request_id))
        .limit(1);
      if (!request) throw new Error("Request not found.");
      if (isHoldResolver(user)) {
        if (service.delivery_status !== "holded") throw new Error("You can only act on a service that is currently Holded.");
        if (user.roleKey === "secretary") requireDepartmentAccess(user, request.department);
      } else if (!isCustodianRole(user)) {
        throw new Error("Permission denied.");
      }

      await tx.insert(deletionLog).values({
        request_type: "service",
        request_id: request.id,
        request_serial: request.serial,
        department: request.department,
        entity_name: service.description,
        reason,
        deleted_by: user.id,
        deleted_at: new Date().toISOString(),
      });
      await tx.delete(serviceItems).where(eq(serviceItems.id, serviceId));
      return request;
    });
    await publishRequestChanged({ type: "service", action: "updated", id: request.id, department: request.department });
  });
}

export async function clearServiceReceivingReportAction(serviceId: number, reasonInput: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["department_requests", "complete_requests"]);
    if (!isCustodianRole(user)) throw new Error("Permission denied.");
    assertId(serviceId, "service ID");
    const reason = requiredReason(reasonInput);

    const request = await getDb().transaction(async (tx) => {
      const [service] = await tx.select().from(serviceItems).where(eq(serviceItems.id, serviceId)).for("update");
      if (!service) throw new Error("Service item not found.");
      if (!service.receiving_report_no) throw new Error("This service has no Receiving Report No. to clear.");
      const [request] = await tx
        .select({ id: serviceRequests.id, serial: serviceRequests.serial, department: serviceRequests.department })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, service.service_request_id))
        .limit(1);
      if (!request) throw new Error("Request not found.");

      let enteredByName: string | null = null;
      if (service.receiving_report_no_updated_by) {
        const [enteredBy] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, service.receiving_report_no_updated_by))
          .limit(1);
        enteredByName = enteredBy?.name ?? null;
      }
      await tx.insert(deletionLog).values({
        request_type: "rr",
        request_id: request.id,
        request_serial: request.serial,
        department: request.department,
        entity_name: `${service.description} — RR# ${service.receiving_report_no}`,
        issued_by_name: enteredByName,
        reason,
        deleted_by: user.id,
        deleted_at: new Date().toISOString(),
      });
      await tx
        .update(serviceItems)
        .set({
          receiving_report_no: null,
          receiving_report_no_updated_by: null,
          receiving_report_no_updated_at: null,
          delivery_status: "pending",
        })
        .where(eq(serviceItems.id, serviceId));
      await tx.update(serviceRequests).set({ pr_status: "pending" }).where(eq(serviceRequests.id, request.id));
      return request;
    });
    await publishRequestChanged({ type: "service", action: "updated", id: request.id, department: request.department });
  });
}
