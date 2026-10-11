"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { runAction, type ActionResult } from "../action-result";
import { getCurrentUser } from "../auth/session";
import { publishRequestChanged } from "../realtime";
import { getDb } from "../db";
import {
  itemCatalog,
  itemRequestItems,
  itemRequests,
  reimbursementRequests,
  serviceRequests,
  urgentRequests,
  users,
} from "../db/schema";

export type SupervisorReviewType = "item" | "service" | "urgent" | "reimbursement";
export type SupervisorDecision = "approved" | "rejected";

interface SupervisorReviewInput {
  type: SupervisorReviewType;
  id: number;
  decision: SupervisorDecision;
  rejectionComment?: string;
}

async function requireSupervisorReviewer() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");

  const role = user.role.trim().toLowerCase();
  if (
    !["supervisor", "manager", "operations_manager", "admin"].includes(role) ||
    (!user.permissions.includes("supervisor_dashboard") && role !== "admin")
  ) {
    throw new Error("Permission denied.");
  }
  return { user, role };
}

function validateInput(input: SupervisorReviewInput): string | null {
  if (!input || !Number.isSafeInteger(input.id) || input.id < 1) {
    throw new Error("Invalid request ID.");
  }
  if (!["item", "service", "urgent", "reimbursement"].includes(input.type)) {
    throw new Error("Invalid request type.");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new Error("Invalid review decision.");
  }

  const comment = typeof input.rejectionComment === "string" ? input.rejectionComment.trim() : "";
  if (input.decision === "rejected" && !comment) {
    throw new Error("A reason is required when declining a request.");
  }
  if (comment.length > 5000) throw new Error("The decline reason must be at most 5000 characters.");
  return input.decision === "rejected" ? comment : null;
}

async function requirePendingRequest(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  input: SupervisorReviewInput
): Promise<{ created_by: string; department: string }> {
  const table =
    input.type === "item"
      ? itemRequests
      : input.type === "service"
        ? serviceRequests
        : input.type === "urgent"
          ? urgentRequests
          : reimbursementRequests;

  const [request] = await tx
    .select({ id: table.id, created_by: table.created_by, department: table.department, supervisor_status: table.supervisor_status })
    .from(table)
    .where(eq(table.id, input.id))
    .for("update");
  if (!request) throw new Error("Request not found.");
  if (request.supervisor_status && request.supervisor_status !== "pending") {
    throw new Error("This request has already been reviewed.");
  }
  return { created_by: request.created_by, department: request.department };
}

async function enforceSupervisorEligibility(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  input: SupervisorReviewInput,
  approverRole: string,
  creatorId: string
): Promise<void> {
  if (["manager", "operations_manager", "admin"].includes(approverRole)) return;

  const [creator] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);
  const creatorRole = creator?.role.trim().toLowerCase();
  if (creatorRole === "supervisor" || creatorRole === "manager") {
    throw new Error("A manager must review requests created by a supervisor or manager.");
  }

  if (input.type !== "item") return;
  const lines = await tx
    .select({ item_name: itemRequestItems.item_name })
    .from(itemRequestItems)
    .where(eq(itemRequestItems.request_id, input.id));
  const itemNames = [...new Set(lines.map((line) => line.item_name.trim().toUpperCase()).filter(Boolean))];
  if (!itemNames.length) return;

  const managerOnlyItems = await tx
    .select({ item_name: itemCatalog.item_name })
    .from(itemCatalog)
    .where(eq(itemCatalog.approval_level, "MANAGER_ONLY"));
  const managerOnlyNames = new Set(
    managerOnlyItems.map((entry) => entry.item_name.trim().toUpperCase())
  );
  if (itemNames.some((name) => managerOnlyNames.has(name))) {
    throw new Error("A manager must review requests that contain a manager-only item.");
  }
}

export async function reviewSupervisorRequestAction(input: SupervisorReviewInput): Promise<ActionResult<void>> {
  return runAction(() => reviewSupervisorRequest(input));
}

async function reviewSupervisorRequest(input: SupervisorReviewInput): Promise<void> {
  const { user, role } = await requireSupervisorReviewer();
  const rejectionComment = validateInput(input);
  const db = getDb();
  const reviewedAt = new Date().toISOString();

  const department = await db.transaction(async (tx) => {
    const request = await requirePendingRequest(tx, input);
    await enforceSupervisorEligibility(tx, input, role, request.created_by);

    const values = {
      supervisor_status: input.decision,
      supervisor_approved_by: user.id,
      supervisor_approved_at: reviewedAt,
      rejection_comment: rejectionComment,
    };
    const table =
      input.type === "item"
        ? itemRequests
        : input.type === "service"
          ? serviceRequests
          : input.type === "urgent"
            ? urgentRequests
            : reimbursementRequests;
    const [updated] = await tx
      .update(table)
      .set(values)
      .where(
        and(
          eq(table.id, input.id),
          or(eq(table.supervisor_status, "pending"), isNull(table.supervisor_status))
        )
      )
      .returning({ id: table.id });
    if (!updated) throw new Error("This request has already been reviewed.");
    return request.department;
  });

  await publishRequestChanged({ type: input.type, action: "updated", id: input.id, department });
}
