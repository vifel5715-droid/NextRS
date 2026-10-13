"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser, type AuthorizedUser } from "@/lib/auth";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { publishRequestChanged } from "@/lib/realtime";
import { getDb } from "@/lib/db";
import {
  itemCatalog,
  itemRequestItems,
  itemRequests,
  reimbursementRequests,
  serviceRequests,
  urgentRequests,
  users,
} from "@/db/schema";
import { recordAudit } from "@/server/audit/audit-log";
import {
  canReviewAtSupervisorStage,
  needsManagerOnlyItemCheck,
  SUPERVISOR_STAGE_ROLES,
} from "@/server/policies/approval-policy";

export type SupervisorReviewType = "item" | "service" | "urgent" | "reimbursement";
export type SupervisorDecision = "approved" | "rejected";

interface SupervisorReviewInput {
  type: SupervisorReviewType;
  id: number;
  decision: SupervisorDecision;
  rejectionComment?: string;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const TABLES = {
  item: itemRequests,
  service: serviceRequests,
  urgent: urgentRequests,
  reimbursement: reimbursementRequests,
} as const;

async function requireSupervisorReviewer(): Promise<AuthorizedUser> {
  const user = await requireUser();
  if (!SUPERVISOR_STAGE_ROLES.includes(user.roleKey)) throw new ForbiddenError();
  requirePermission(user, ["supervisor_dashboard"]);
  return user;
}

function validateInput(input: SupervisorReviewInput): string | null {
  if (!input || !Number.isSafeInteger(input.id) || input.id < 1) {
    throw new ValidationError("Invalid request ID.");
  }
  if (!(input.type in TABLES)) throw new ValidationError("Invalid request type.");
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ValidationError("Invalid review decision.");
  }

  const comment = typeof input.rejectionComment === "string" ? input.rejectionComment.trim() : "";
  if (input.decision === "rejected" && !comment) {
    throw new ValidationError("A reason is required when declining a request.");
  }
  if (comment.length > 5000) throw new ValidationError("The decline reason must be at most 5000 characters.");
  return input.decision === "rejected" ? comment : null;
}

async function lockPendingRequest(tx: Tx, input: SupervisorReviewInput) {
  const table = TABLES[input.type];
  const [request] = await tx
    .select({
      serial: table.serial,
      created_by: table.created_by,
      department: table.department,
      supervisor_status: table.supervisor_status,
    })
    .from(table)
    .where(eq(table.id, input.id))
    .for("update");
  if (!request) throw new NotFoundError("Request not found.");
  if (request.supervisor_status && request.supervisor_status !== "pending") {
    throw new ValidationError("This request has already been reviewed.");
  }
  return request;
}

async function containsManagerOnlyItem(tx: Tx, requestId: number): Promise<boolean> {
  const lines = await tx
    .select({ item_name: itemRequestItems.item_name })
    .from(itemRequestItems)
    .where(eq(itemRequestItems.request_id, requestId));
  const itemNames = new Set(lines.map((line) => line.item_name.trim().toUpperCase()).filter(Boolean));
  if (!itemNames.size) return false;

  const managerOnly = await tx
    .select({ item_name: itemCatalog.item_name })
    .from(itemCatalog)
    .where(eq(itemCatalog.approval_level, "MANAGER_ONLY"));
  return managerOnly.some((entry) => itemNames.has(entry.item_name.trim().toUpperCase()));
}

export async function reviewSupervisorRequestAction(input: SupervisorReviewInput): Promise<ActionResult<void>> {
  return runAction(() => reviewSupervisorRequest(input));
}

async function reviewSupervisorRequest(input: SupervisorReviewInput): Promise<void> {
  const user = await requireSupervisorReviewer();
  const rejectionComment = validateInput(input);
  const reviewedAt = new Date().toISOString();
  const table = TABLES[input.type];

  const department = await getDb().transaction(async (tx) => {
    const request = await lockPendingRequest(tx, input);

    const [creator] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, request.created_by))
      .limit(1);
    const decision = canReviewAtSupervisorStage({
      reviewer: { id: user.id, roleKey: user.roleKey },
      creator: { id: request.created_by, roleKey: creator?.role.trim().toLowerCase() ?? null },
      containsManagerOnlyItem:
        input.type === "item" && needsManagerOnlyItemCheck(user.roleKey)
          ? await containsManagerOnlyItem(tx, input.id)
          : false,
    });
    if (!decision.allowed) throw new ForbiddenError(decision.reason);

    const [updated] = await tx
      .update(table)
      .set({
        supervisor_status: input.decision,
        supervisor_approved_by: user.id,
        supervisor_approved_at: reviewedAt,
        rejection_comment: rejectionComment,
      })
      .where(
        and(
          eq(table.id, input.id),
          or(eq(table.supervisor_status, "pending"), isNull(table.supervisor_status))
        )
      )
      .returning({ id: table.id });
    if (!updated) throw new ValidationError("This request has already been reviewed.");

    await recordAudit(tx, {
      action: "request.supervisor_review",
      actor: { id: user.id, name: user.name },
      entityType: `${input.type}_request`,
      entityId: input.id,
      department: request.department,
      details: {
        serial: request.serial,
        decision: input.decision,
        reviewerRole: user.roleKey,
        ...(rejectionComment ? { reason: rejectionComment } : {}),
      },
    });
    return request.department;
  });

  await publishRequestChanged({ type: input.type, action: "updated", id: input.id, department });
}
