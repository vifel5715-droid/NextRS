"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { publishRequestChanged } from "@/lib/realtime";
import { getDb } from "@/lib/db";
import { itemRequests, serviceRequests } from "@/db/schema";
import { recordAudit } from "@/server/audit/audit-log";

export type CustodianRequestType = "item" | "service";
export type CustodianDecision = "approved" | "rejected";

interface CustodianReviewInput {
  type: CustodianRequestType;
  id: number;
  decision: CustodianDecision;
  rejectionComment?: string;
}

export async function reviewCustodianRequestAction(input: CustodianReviewInput): Promise<ActionResult<void>> {
  return runAction(() => reviewCustodianRequest(input));
}

async function reviewCustodianRequest(input: CustodianReviewInput): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");

  const role = user.role.trim().toLowerCase();
  if (!["custodian", "admin"].includes(role)) throw new Error("Permission denied.");
  if (role !== "admin" && !user.permissions.includes("pending_items_services") && !user.permissions.includes("department_requests")) {
    throw new Error("Permission denied.");
  }

  if (!input || !Number.isSafeInteger(input.id) || input.id < 1) {
    throw new Error("Invalid request ID.");
  }
  if (input.type !== "item" && input.type !== "service") {
    throw new Error("Invalid request type.");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new Error("Invalid review decision.");
  }
  const rejectionComment =
    typeof input.rejectionComment === "string" ? input.rejectionComment.trim() : "";
  if (input.decision === "rejected" && !rejectionComment) {
    throw new Error("A reason is required when declining a request.");
  }
  if (rejectionComment.length > 5000) {
    throw new Error("The decline reason must be at most 5000 characters.");
  }

  const db = getDb();
  const table = input.type === "item" ? itemRequests : serviceRequests;
  const reviewedAt = new Date().toISOString();

  const department = await db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        id: table.id,
        serial: table.serial,
        department: table.department,
        supervisor_status: table.supervisor_status,
        custodian_status: table.custodian_status,
      })
      .from(table)
      .where(eq(table.id, input.id))
      .for("update");

    if (!request) throw new Error("Request not found.");
    if (request.supervisor_status !== "approved") {
      throw new Error("Only supervisor-approved requests can be reviewed by the custodian.");
    }
    if (request.custodian_status && request.custodian_status !== "pending") {
      throw new Error("This request has already been reviewed by the custodian.");
    }

    const [updated] = await tx
      .update(table)
      .set({
        status: input.decision,
        custodian_status: input.decision,
        custodian_approved_by: user.id,
        custodian_approved_at: reviewedAt,
        rejection_comment: input.decision === "rejected" ? rejectionComment : null,
      })
      .where(
        and(
          eq(table.id, input.id),
          eq(table.supervisor_status, "approved"),
          or(eq(table.custodian_status, "pending"), isNull(table.custodian_status))
        )
      )
      .returning({ id: table.id });

    if (!updated) throw new Error("This request has already been reviewed by the custodian.");

    await recordAudit(tx, {
      action: "request.custodian_review",
      actor: { id: user.id, name: user.name },
      entityType: `${input.type}_request`,
      entityId: input.id,
      department: request.department,
      details: {
        serial: request.serial,
        decision: input.decision,
        ...(input.decision === "rejected" ? { reason: rejectionComment } : {}),
      },
    });
    return request.department;
  });

  await publishRequestChanged({ type: input.type, action: "updated", id: input.id, department });
}
