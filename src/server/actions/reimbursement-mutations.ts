"use server";

import { eq } from "drizzle-orm";
import { runAction, type ActionResult } from "../action-result";
import {
  asRecord,
  assertId,
  isRequestOwner,
  optionalString,
  requireDepartmentAccess,
  requirePermission,
  requireRole,
  requireUser,
} from "../access";
import { getDb } from "../db";
import { reimbursementRequests } from "../db/schema";
import { publishRequestChanged } from "../realtime";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function parseDecision(value: unknown): { decision: "approved" | "rejected"; comment: string | null } {
  const input = asRecord(value);
  if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Invalid review decision.");
  const comment = optionalString(input, "rejection_comment", 500, "decline reason") ?? "";
  if (input.decision === "rejected" && !comment) throw new Error("A reason is required to decline a request.");
  return { decision: input.decision, comment: input.decision === "rejected" ? comment.toUpperCase() : null };
}

/** Purchaser stage — only once Supervisor/Manager approved. */
export async function reviewReimbursementAsPurchaserAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["purchaser_dashboard"]);
    requireRole(user, ["purchaser", "operations_manager", "admin"]);
    assertId(id, "request ID");
    const { decision, comment } = parseDecision(value);

    const request = await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(reimbursementRequests).where(eq(reimbursementRequests.id, id)).for("update");
      if (!existing) throw new Error("Reimbursement request not found.");
      if (existing.supervisor_status !== "approved") throw new Error("Awaiting Supervisor/Manager approval.");
      if (existing.purchaser_status !== "pending") throw new Error("This request has already been reviewed by Purchasing.");
      await tx
        .update(reimbursementRequests)
        .set({
          purchaser_status: decision,
          purchaser_approved_by: user.id,
          purchaser_approved_at: new Date().toISOString(),
          rejection_comment: comment,
        })
        .where(eq(reimbursementRequests.id, id));
      return existing;
    });
    await publishRequestChanged({ type: "reimbursement", action: "updated", id, department: request.department });
  });
}

/** AP Officer stage — only once Purchasing approved. */
export async function reviewReimbursementAsAPOfficerAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["ap_officer_dashboard"]);
    requireRole(user, ["ap_officer", "operations_manager", "admin"]);
    assertId(id, "request ID");
    const { decision, comment } = parseDecision(value);

    const request = await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(reimbursementRequests).where(eq(reimbursementRequests.id, id)).for("update");
      if (!existing) throw new Error("Reimbursement request not found.");
      if (existing.purchaser_status !== "approved") throw new Error("Awaiting Purchaser approval.");
      if (existing.ap_status !== "pending") throw new Error("This request has already been reviewed by AP.");
      await tx
        .update(reimbursementRequests)
        .set({
          ap_status: decision,
          ap_approved_by: user.id,
          ap_approved_at: new Date().toISOString(),
          rejection_comment: comment,
        })
        .where(eq(reimbursementRequests.id, id));
      return existing;
    });
    await publishRequestChanged({ type: "reimbursement", action: "updated", id, department: request.department });
  });
}

/** AP Officer marks an approved reimbursement as paid out. */
export async function closeReimbursementAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["ap_officer_dashboard"]);
    requireRole(user, ["ap_officer", "operations_manager", "admin"]);
    assertId(id, "request ID");

    const request = await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(reimbursementRequests).where(eq(reimbursementRequests.id, id)).for("update");
      if (!existing) throw new Error("Reimbursement request not found.");
      if (existing.ap_status !== "approved") throw new Error("Only AP-approved requests can be closed.");
      await tx
        .update(reimbursementRequests)
        .set({ ap_status: "closed", closed_by: user.id, closed_at: new Date().toISOString() })
        .where(eq(reimbursementRequests.id, id));
      return existing;
    });
    await publishRequestChanged({ type: "reimbursement", action: "updated", id, department: request.department });
  });
}

/**
 * Replace (or add) the supporting document. Allowed for the requester (Staff:
 * own request; Secretary/Supervisor/Manager: own department; admin) until AP
 * has given final approval, and never on a declined request — swapping the
 * receipt after the final sign-off would change what was approved. The file
 * is fully validated before the row is touched, so a failed upload keeps the
 * existing document.
 */
export async function replaceReimbursementAttachmentAction(
  formData: FormData
): Promise<ActionResult<{ attachment_name: string; attachment_size: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["create_request"]);
    const id = assertId(Number(formData.get("id")), "request ID");
    const entry = formData.get("attachment");
    if (!(entry instanceof File) || entry.size === 0) throw new Error("Choose a PDF file to upload.");
    if (entry.size > MAX_ATTACHMENT_BYTES) throw new Error("PDF attachments cannot exceed 10 MB.");
    if (entry.type !== "application/pdf" || !entry.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF attachments are allowed.");
    }
    const data = Buffer.from(await entry.arrayBuffer());
    if (data.length < 5 || data.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("The attachment is not a valid PDF file.");
    }
    const name = entry.name.replace(/[\\/\x00-\x1F\x7F]/g, "_").slice(0, 255);

    const request = await getDb().transaction(async (tx) => {
      const [existing] = await tx.select({
        id: reimbursementRequests.id,
        department: reimbursementRequests.department,
        created_by: reimbursementRequests.created_by,
        requested_by: reimbursementRequests.requested_by,
        supervisor_status: reimbursementRequests.supervisor_status,
        purchaser_status: reimbursementRequests.purchaser_status,
        ap_status: reimbursementRequests.ap_status,
      }).from(reimbursementRequests).where(eq(reimbursementRequests.id, id)).for("update");
      if (!existing) throw new Error("Reimbursement request not found.");
      requireDepartmentAccess(user, existing.department);
      if (
        user.roleKey !== "admin" &&
        !["secretary", "supervisor", "manager"].includes(user.roleKey) &&
        !isRequestOwner(user, existing)
      ) {
        throw new Error("You can only update the supporting document of your own request.");
      }
      if ([existing.supervisor_status, existing.purchaser_status, existing.ap_status].includes("rejected")) {
        throw new Error("This request was declined — its supporting document can no longer be changed.");
      }
      if (existing.ap_status === "approved" || existing.ap_status === "closed") {
        throw new Error("AP has already approved this request — its supporting document can no longer be changed.");
      }
      await tx
        .update(reimbursementRequests)
        .set({ attachment_name: name, attachment_data: data, attachment_size: data.length })
        .where(eq(reimbursementRequests.id, id));
      return existing;
    });

    await publishRequestChanged({ type: "reimbursement", action: "updated", id, department: request.department });
    return { attachment_name: name, attachment_size: data.length };
  });
}
