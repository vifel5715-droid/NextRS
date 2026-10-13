"use server";

import { eq } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { requirePermission, requireRole } from "@/lib/permissions";
import { assertId, requiredReason } from "@/lib/validation";
import { getDb } from "@/lib/db";
import { deletionLog, itemIssuanceAudits, itemRequestItems, itemRequests, serviceRequests } from "@/db/schema";
import { publishRequestChanged } from "@/lib/realtime";

/**
 * Deletes one issuance record and gives back the quantity it moved — the
 * audit row is the only record of its own transaction, so removing it must
 * reverse it. Logged to deletion_log (request_type "audit"). Ported from the
 * legacy deleteIssuanceAudit + computeAuditReversal.
 */
export async function deleteIssuanceAuditAction(auditId: number, reasonInput: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["custodian", "admin"]);
    requirePermission(user, ["department_requests", "complete_requests"]);
    assertId(auditId, "issuance record ID");
    const reason = requiredReason(reasonInput);

    const request = await getDb().transaction(async (tx) => {
      const [audit] = await tx.select().from(itemIssuanceAudits).where(eq(itemIssuanceAudits.id, auditId)).for("update");
      if (!audit) throw new Error("Issuance record not found.");
      const [item] = await tx
        .select()
        .from(itemRequestItems)
        .where(eq(itemRequestItems.id, audit.item_request_item_id))
        .for("update");
      const [request] = await tx
        .select({ id: itemRequests.id, serial: itemRequests.serial, department: itemRequests.department })
        .from(itemRequests)
        .where(eq(itemRequests.id, audit.request_id))
        .limit(1);

      if (item) {
        if (audit.transaction_type === "OUT") {
          const newOut = Math.max(0, (item.quantity_out ?? 0) - audit.quantity_issued);
          await tx
            .update(itemRequestItems)
            .set({ quantity_out: newOut, qty_balance: Math.max(0, item.quantity - newOut) })
            .where(eq(itemRequestItems.id, item.id));
        } else {
          const newDelivered = Math.max(0, (item.quantity_delivered ?? 0) - audit.quantity_issued);
          await tx
            .update(itemRequestItems)
            .set({
              quantity_delivered: newDelivered,
              // No longer fully arrived — undo the completion it triggered.
              ...(item.pr_status === "DELIVERED" && newDelivered < item.quantity ? { pr_status: "DELIVERED PARTIAL" } : {}),
            })
            .where(eq(itemRequestItems.id, item.id));
        }
      }

      await tx.insert(deletionLog).values({
        request_type: "audit",
        request_id: audit.request_id,
        request_serial: request?.serial ?? "",
        department: request?.department ?? "",
        entity_name: `${item?.item_name ?? "Unknown item"} — ${audit.transaction_type ?? "?"} #${audit.issuance_number || "N/A"}`,
        quantity: audit.quantity_issued,
        uom: item?.uom ?? null,
        issued_by_name: audit.custodian_name,
        reason,
        deleted_by: user.id,
        deleted_at: new Date().toISOString(),
      });
      await tx.delete(itemIssuanceAudits).where(eq(itemIssuanceAudits.id, auditId));
      return request;
    });

    if (request) {
      await publishRequestChanged({ type: "item", action: "updated", id: request.id, department: request.department });
    }
  });
}

/**
 * Undo an approval chain (admin-only in the legacy app: the reset routes
 * were gated on users_management, which only admin has by default).
 */
export async function resetRequestApprovalAction(
  type: "item" | "service",
  id: number,
  target?: "supervisor" | "custodian"
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["users_management"]);
    assertId(id, "request ID");
    if (type !== "item" && type !== "service") throw new Error("Invalid request type.");
    if (target !== undefined && target !== "supervisor" && target !== "custodian") throw new Error("Invalid reset target.");

    const table = type === "item" ? itemRequests : serviceRequests;
    const values: Record<string, string | null> = { rejection_comment: null };
    if (!target || target === "custodian") {
      Object.assign(values, { status: "pending", custodian_status: "pending", custodian_approved_by: null, custodian_approved_at: null });
    }
    if (!target || target === "supervisor") {
      Object.assign(values, { supervisor_status: "pending", supervisor_approved_by: null, supervisor_approved_at: null });
    }
    const [updated] = await getDb()
      .update(table)
      .set(values)
      .where(eq(table.id, id))
      .returning({ id: table.id, department: table.department });
    if (!updated) throw new Error("Request not found.");
    await publishRequestChanged({ type, action: "updated", id, department: updated.department });
  });
}
