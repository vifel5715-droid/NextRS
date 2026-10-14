"use server";

import { inArray } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { requireRole } from "@/lib/permissions";
import { assertId } from "@/lib/validation";
import { getDb } from "@/lib/db";
import {
  itemRequestItems,
  itemRequests,
  reimbursementRequests,
  serviceRequests,
  urgentRequestItems,
  urgentRequests,
} from "@/db/schema";
import { publishRequestChanged } from "@/lib/realtime";
import { isItemServedOrClosed } from "@/lib/utils/status";

type CompleteRequestType = "item" | "service" | "urgent" | "reimbursement";

const MAX_BULK_DELETE = 1000;

/**
 * Admin-only bulk delete of completed transactions from the Complete Requests
 * page's current Start/End Date range. The client sends the ids it is showing;
 * each one is re-checked here against the same "complete" rule that page uses,
 * so a request that has since gone back to pending is skipped, never deleted.
 * Child rows (items, services, audits, status, payment forms) go with the
 * header via ON DELETE CASCADE.
 */
export async function deleteCompleteRequestsAction(
  type: CompleteRequestType,
  idsInput: number[]
): Promise<ActionResult<{ deleted: number; skipped: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["admin"]);
    if (!["item", "service", "urgent", "reimbursement"].includes(type)) throw new Error("Invalid request type.");
    if (!Array.isArray(idsInput) || idsInput.length === 0) throw new Error("No requests to delete.");
    if (idsInput.length > MAX_BULK_DELETE) throw new Error(`At most ${MAX_BULK_DELETE} requests can be deleted at once.`);
    const ids = [...new Set(idsInput.map((id) => assertId(id, "request ID")))];

    const deleted = await getDb().transaction(async (tx) => {
      if (type === "item") {
        const headers = await tx
          .select({ id: itemRequests.id, department: itemRequests.department })
          .from(itemRequests)
          .where(inArray(itemRequests.id, ids))
          .for("update");
        const lines = await tx
          .select({
            request_id: itemRequestItems.request_id,
            quantity: itemRequestItems.quantity,
            quantity_out: itemRequestItems.quantity_out,
            delivery_status: itemRequestItems.delivery_status,
          })
          .from(itemRequestItems)
          .where(inArray(itemRequestItems.request_id, ids));
        const complete = headers.filter((header) => {
          const own = lines.filter((line) => line.request_id === header.id);
          return own.length > 0 && own.every(isItemServedOrClosed);
        });
        if (complete.length) await tx.delete(itemRequests).where(inArray(itemRequests.id, complete.map((r) => r.id)));
        return complete;
      }

      if (type === "service") {
        const headers = await tx
          .select({ id: serviceRequests.id, department: serviceRequests.department, pr_status: serviceRequests.pr_status })
          .from(serviceRequests)
          .where(inArray(serviceRequests.id, ids))
          .for("update");
        const complete = headers.filter((header) => header.pr_status === "finish");
        if (complete.length) await tx.delete(serviceRequests).where(inArray(serviceRequests.id, complete.map((r) => r.id)));
        return complete;
      }

      if (type === "urgent") {
        const headers = await tx
          .select({ id: urgentRequests.id, department: urgentRequests.department })
          .from(urgentRequests)
          .where(inArray(urgentRequests.id, ids))
          .for("update");
        const lines = await tx
          .select({
            request_id: urgentRequestItems.request_id,
            is_inventoriable: urgentRequestItems.is_inventoriable,
            delivery_status: urgentRequestItems.delivery_status,
          })
          .from(urgentRequestItems)
          .where(inArray(urgentRequestItems.request_id, ids));
        // Same rule as PurchaserDashboard's "Delivered" label — only Not
        // Inventoriable items track delivery, and all of them must be delivered.
        const complete = headers.filter((header) => {
          const tracked = lines.filter((line) => line.request_id === header.id && !line.is_inventoriable);
          return tracked.length > 0 && tracked.every((line) => line.delivery_status === "delivered");
        });
        if (complete.length) await tx.delete(urgentRequests).where(inArray(urgentRequests.id, complete.map((r) => r.id)));
        return complete;
      }

      const headers = await tx
        .select({ id: reimbursementRequests.id, department: reimbursementRequests.department, ap_status: reimbursementRequests.ap_status })
        .from(reimbursementRequests)
        .where(inArray(reimbursementRequests.id, ids))
        .for("update");
      const complete = headers.filter((header) => header.ap_status === "closed");
      if (complete.length) await tx.delete(reimbursementRequests).where(inArray(reimbursementRequests.id, complete.map((r) => r.id)));
      return complete;
    });

    await Promise.all(
      deleted.map((request) => publishRequestChanged({ type, action: "deleted", id: request.id, department: request.department }))
    );
    return { deleted: deleted.length, skipped: ids.length - deleted.length };
  });
}
