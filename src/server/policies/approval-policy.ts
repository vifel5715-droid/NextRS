import type { PolicyDecision } from "@/lib/permissions";

/**
 * Who may give the Supervisor/Manager-stage decision on a request.
 *
 * Pure so every rule is unit tested (tests/unit/approval-policy.test.ts).
 * Rules, in order:
 *  1. Only supervisor, manager, operations_manager and admin review at this
 *     stage (the caller separately requires the supervisor_dashboard page
 *     permission, except for admin).
 *  2. Nobody reviews their own request, except a manager: a manager-created
 *     request has no higher department-level reviewer, so the business
 *     allows a manager to approve their own (decision recorded 2026-10-13).
 *  3. Requests created by a supervisor or manager need a manager-tier
 *     reviewer (manager, operations_manager or admin).
 *  4. Item requests containing a MANAGER_ONLY catalog item need a
 *     manager-tier reviewer.
 */
export const SUPERVISOR_STAGE_ROLES: readonly string[] = ["supervisor", "manager", "operations_manager", "admin"];
export const MANAGER_TIER_ROLES: readonly string[] = ["manager", "operations_manager", "admin"];
export const SELF_REVIEW_ALLOWED_ROLES: readonly string[] = ["manager"];

export interface SupervisorStageContext {
  reviewer: { id: string; roleKey: string };
  creator: { id: string; roleKey: string | null };
  containsManagerOnlyItem: boolean;
}

export function canReviewAtSupervisorStage(context: SupervisorStageContext): PolicyDecision {
  const { reviewer, creator, containsManagerOnlyItem } = context;

  if (!SUPERVISOR_STAGE_ROLES.includes(reviewer.roleKey)) {
    return { allowed: false, reason: "Permission denied." };
  }
  if (reviewer.id === creator.id && !SELF_REVIEW_ALLOWED_ROLES.includes(reviewer.roleKey)) {
    return { allowed: false, reason: "You cannot review your own request. Another approver must review it." };
  }
  if (MANAGER_TIER_ROLES.includes(reviewer.roleKey)) return { allowed: true };

  if (creator.roleKey === "supervisor" || creator.roleKey === "manager") {
    return { allowed: false, reason: "A manager must review requests created by a supervisor or manager." };
  }
  if (containsManagerOnlyItem) {
    return { allowed: false, reason: "A manager must review requests that contain a manager-only item." };
  }
  return { allowed: true };
}

/** True when the policy can only be decided by also checking the request's items. */
export function needsManagerOnlyItemCheck(reviewerRoleKey: string): boolean {
  return !MANAGER_TIER_ROLES.includes(reviewerRoleKey);
}
