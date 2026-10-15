import type { User } from "@/types";
import type { AuthorizedUser } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";

/**
 * Shared authorization helpers, enforced inside every Server Action and
 * Route Handler (never only in the UI or proxy). They encode the same rules
 * the legacy Express controllers used, so behavior carries over.
 *
 * Gates follow the convention every action uses: a page permission
 * (role_permissions.permission_key) plus, where the business rule needs one,
 * a role check. role_permissions.can_edit is NOT consulted because the
 * database initializer never backfills it, so most production roles have
 * can_edit=false everywhere; gating on it would lock everyone out.
 *
 * Pure functions of the user and record — no I/O — so they are unit tested
 * directly (tests/unit/permissions.test.ts).
 */
export type { AuthorizedUser };

export function hasAnyPermission(user: User, keys: readonly string[]): boolean {
  return keys.some((key) => user.permissions.includes(key));
}

export function requirePermission(user: AuthorizedUser, keys: readonly string[]): void {
  if (user.roleKey === "admin") return;
  if (!hasAnyPermission(user, keys)) throw new ForbiddenError();
}

export function requireRole(user: AuthorizedUser, roles: readonly string[]): void {
  if (!roles.includes(user.roleKey)) throw new ForbiddenError();
}

/**
 * Roles that see every department. Framed as an exclusion list so an unknown
 * (custom) role defaults to department-scoped — the safe choice. Mirrors the
 * legacy UNSCOPED_ROLES plus the newer cross-department reviewer roles.
 */
const UNSCOPED_ROLES = new Set([
  "custodian",
  "admin",
  "director",
  "purchaser",
  "ap_officer",
  "operations_manager",
]);

export function isDepartmentScoped(user: AuthorizedUser): boolean {
  return !UNSCOPED_ROLES.has(user.roleKey);
}

export const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

export function requireDepartmentAccess(user: AuthorizedUser, department: string): void {
  if (isDepartmentScoped(user) && !sameText(user.department, department)) {
    throw new ForbiddenError("You do not have access to this request.");
  }
}

/** Created it, or is the named requester (a secretary can file on someone's behalf). */
export function isRequestOwner(
  user: AuthorizedUser,
  request: { created_by: string; requested_by: string | null }
): boolean {
  return request.created_by === user.id || sameText(request.requested_by, user.name);
}

/** Secretary/Supervisor/Manager — the roles that resolve the HOLD hand-off. */
export function isHoldResolver(user: AuthorizedUser): boolean {
  return ["secretary", "supervisor", "manager"].includes(user.roleKey);
}

export interface EditableRequest {
  created_by: string;
  requested_by: string | null;
  supervisor_status: string | null;
  custodian_status: string | null;
}

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

const isReviewed = (status: string | null) => status === "approved" || status === "rejected";

/**
 * Requester-side edit rule for a request's header/lines (ported from the
 * legacy updateItemRequest/updateServiceRequest): Staff may only edit their
 * own request, and Staff/Secretary only while neither approval stage has
 * acted. Other roles are governed by their page permission and department
 * scope, checked separately by the caller.
 */
export function canEditRequest(user: AuthorizedUser, request: EditableRequest): PolicyDecision {
  if (user.roleKey !== "staff" && user.roleKey !== "secretary") return { allowed: true };
  if (user.roleKey === "staff" && !isRequestOwner(user, request)) {
    return { allowed: false, reason: "You can only edit your own request." };
  }
  if (isReviewed(request.supervisor_status) || isReviewed(request.custodian_status)) {
    return { allowed: false, reason: "This request has already been reviewed and can no longer be edited." };
  }
  return { allowed: true };
}

export function assertCanEditRequest(user: AuthorizedUser, request: EditableRequest): void {
  const decision = canEditRequest(user, request);
  if (!decision.allowed) throw new ForbiddenError(decision.reason);
}

export const SERVICE_NOT_APPROVED_MESSAGE = "This service cannot be edited until the required approvals are completed.";

const isApproved = (status: string | null | undefined) => (status ?? "").trim().toLowerCase() === "approved";

/**
 * A service request's fulfillment fields (each line's status, Receiving
 * Report No. and description, and the request's PR Number / PR Status) are
 * only editable once BOTH approval stages have approved: Supervisor/Manager,
 * then Custodian. Pending, Declined or reset approvals keep them locked. The
 * requester's own pre-review corrections are a separate rule (canEditRequest).
 */
export function isServiceFulfillmentEditable(request: {
  supervisor_status?: string | null;
  custodian_status?: string | null;
}): boolean {
  return isApproved(request.supervisor_status) && isApproved(request.custodian_status);
}

export function assertServiceFulfillmentEditable(request: {
  supervisor_status?: string | null;
  custodian_status?: string | null;
}): void {
  if (!isServiceFulfillmentEditable(request)) throw new ForbiddenError(SERVICE_NOT_APPROVED_MESSAGE);
}
