/**
 * ARCH: Who is allowed to see which requests.
 *
 * The four list endpoints (item, service, pending, delivered) each rebuilt these
 * rules inline. They are extracted here so the rules are stated once, but kept
 * deliberately thin: the endpoints still assemble their own queries, because
 * their filters genuinely differ and hiding that behind a generic query builder
 * would make the differences harder to see rather than easier.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import { users } from "../../database/schema.js";
import type { JwtPayload } from "../../shared/types/jwt.js";

/**
 * Roles that see every department, not just their own. Framed as an
 * exclusion list (rather than the department-scoped roles being the
 * explicit set) so a role this doesn't recognize — including any new
 * custom role created via the Admin Dashboard's Roles tab — defaults to
 * SCOPED, the safe choice. Previously this was the other way around
 * (an explicit "scoped" set with everything else falling through to
 * unscoped), which meant a brand-new custom role silently saw every
 * department's data. Behavior for all 7 existing roles is unchanged:
 * the same 4 (staff/secretary/supervisor/manager) stay scoped, the same
 * 3 (custodian/admin/director) stay unscoped.
 *
 * `purchaser` is unscoped too — the Purchaser Dashboard's whole purpose is
 * to process Stockroom-approved Urgent Requests company-wide, not just its
 * own department's. `ap_officer` is unscoped for the same reason: AP
 * processes Purchaser-approved Reimbursement Requests company-wide.
 *
 * `operations_manager` is unscoped too — it exists specifically to approve
 * across every department at every stage, so a department-scoped view would
 * defeat its purpose.
 */
export const UNSCOPED_ROLES = new Set(["custodian", "admin", "director", "purchaser", "ap_officer", "operations_manager"]);

export const isDepartmentScoped = (role: string) => !UNSCOPED_ROLES.has(role.toLowerCase());

/**
 * The department to scope a listing to.
 *
 * The token usually carries it, but not always — older sessions omit it — so
 * fall back to the users table for the roles where the value actually changes
 * what they can see. Custodians and admins are unscoped, so the lookup is
 * skipped for them.
 */
export async function resolveUserDepartment(currentUser: JwtPayload): Promise<string | undefined> {
  if (currentUser.department) return currentUser.department;
  if (!isDepartmentScoped(currentUser.role)) return undefined;

  const [row] = await db
    .select({ department: users.department })
    .from(users)
    .where(eq(users.id, currentUser.id));
  return row?.department;
}

/**
 * Fills in `supervisor_approved_by_role` / `custodian_approved_by_role` on list
 * rows, in place. Both list endpoints need it and the frontend's composite
 * status depends on it, so the fields are always set — null rather than absent
 * when there is no approver.
 */
export async function attachApproverRoles(
  rows: Array<Record<string, any>>
): Promise<void> {
  const approverIds = rows
    .flatMap((row) => [row.supervisor_approved_by, row.custodian_approved_by])
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

  const roleById = new Map<string, string>();
  if (approverIds.length > 0) {
    const approvers = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.id, approverIds));
    for (const approver of approvers) roleById.set(approver.id, approver.role);
  }

  for (const row of rows) {
    row.supervisor_approved_by_role = row.supervisor_approved_by
      ? roleById.get(row.supervisor_approved_by) || null
      : null;
    row.custodian_approved_by_role = row.custodian_approved_by
      ? roleById.get(row.custodian_approved_by) || null
      : null;
  }
}
