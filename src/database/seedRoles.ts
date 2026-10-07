/**
 * ARCH: Built-in role/permission seed data and the logic that writes it —
 * shared by `npm run init-db` (fresh installs) and `npm run migrate:add-roles`
 * (existing installs that predate a given permission key), so the two can't
 * drift apart. Same sharing convention as database/tables.ts's
 * TABLE_STATEMENTS. Permission sets transcribed 1:1 from the hardcoded role
 * arrays that used to live in client/src/components/Sidebar.tsx and
 * client/src/App.tsx's route allowedRoles, so behavior for every existing
 * role is unchanged.
 *
 * A custom (non-system) role created later through the Admin Dashboard's
 * Roles tab only ever grants entries from this same permission-key set —
 * see core/security/permissionKeys.ts for the full list and
 * roles.controller.ts for how a new role's checkboxes turn into
 * role_permissions rows.
 */
import type { Pool } from "pg";
import { PermissionKey } from "../core/security/permissionKeys.js";

// Keys whose whole purpose is a single write action — a role granted one of
// these should start with Edit already on rather than view-only, since
// there's no read-only phase worth shipping first (see
// add-pending-item-entry-permission.ts's/add-new-item-list-permission.ts's
// same reasoning, folded in here so a *fresh* install gets it right directly
// instead of needing those dedicated backfill scripts afterward — they still
// matter for existing installs seeded before a key moved here).
const EDIT_BY_DEFAULT = new Set<PermissionKey>(["pending_item_entry", "new_item_list", "ap_officer_dashboard", "petty_cash"]);

const ALL_PERMISSIONS: PermissionKey[] = [
  "overview",
  "create_request",
  "department_requests",
  "pending_items_services",
  "delivered_items",
  "item_list",
  "held_items",
  "complete_requests",
  "adjustment_history",
  "deleted_items",
  "supervisor_dashboard",
  "purchaser_dashboard",
  "urgent_items",
  "pending_item_entry",
  "new_item_list",
  "ap_officer_dashboard",
  "petty_cash",
  "users_management",
  "submitted_payment_requests",
];

const STAFF: PermissionKey[] = [
  "overview", "create_request", "pending_items_services", "delivered_items",
  "item_list", "complete_requests", "adjustment_history", "deleted_items",
];
const SECRETARY: PermissionKey[] = [...STAFF, "held_items"];
const SUPERVISOR: PermissionKey[] = [...SECRETARY, "supervisor_dashboard"];
const MANAGER: PermissionKey[] = SUPERVISOR;
const CUSTODIAN: PermissionKey[] = [
  "overview", "department_requests", "pending_items_services", "delivered_items",
  "item_list", "held_items", "complete_requests", "adjustment_history", "deleted_items",
  "urgent_items", "pending_item_entry", "new_item_list", "petty_cash",
];
const DIRECTOR: PermissionKey[] = CUSTODIAN;
// Purchaser Dashboard, Phase 2 of the Urgent Request workflow — a new role
// (not a repurposed existing one) since Purchasing is a genuinely separate
// function from Custodian/Stockroom review. pending_items_services and
// delivered_items give visibility into those existing pages too —
// Purchasing needs that same across-the-board view of pending/delivered
// purchase activity, not just what originated from an Urgent Request. More
// keys (e.g. item_list, for linking a Purchase Order to a catalog entry) get
// added here as later phases need them. submitted_payment_requests (view
// only — see urgent-request.service.ts's savePaymentRequestForm lock) lets
// Purchaser see every F-ACC-003 form it has already submitted, but not edit
// it any further; that edit right belongs to AP Officer once submitted.
const PURCHASER: PermissionKey[] = ["overview", "purchaser_dashboard", "pending_items_services", "delivered_items", "urgent_items", "submitted_payment_requests"];
// Reimbursement Request workflow's final approval stage — a new role since
// Accounts Payable is a genuinely separate function from Purchasing, same
// reasoning as PURCHASER above. Only needs its own dedicated dashboard;
// unlike Purchaser it has no reason to see pending/delivered purchase
// activity, since Reimbursement Requests don't produce Item List entries.
// submitted_payment_requests view, paired with the ap_officer_dashboard Edit
// grant it already has, is what actually lets AP Officer edit a submitted
// F-ACC-003 form — see savePaymentRequestForm/saveItemPaymentRequestForm.
const AP_OFFICER: PermissionKey[] = ["overview", "ap_officer_dashboard", "petty_cash", "submitted_payment_requests"];
// A cross-cutting super-approver — sees and can act on every approval stage
// across all four request types (Item, Service, Urgent, Reimbursement), but
// nothing else: no create_request, no Item Master List, no reporting pages.
// Reuses the same four dashboards Supervisor/Custodian/Purchaser/AP Officer
// already have, rather than a new dashboard of its own — see
// canApproveAsSupervisor (status.service.ts) and UNSCOPED_ROLES
// (requestAccess.ts) for the role-name checks that had to recognize this
// role by name, since not every approval stage is purely permission-gated.
// Also gets submitted_payment_requests, same reasoning as AP_OFFICER above —
// its ap_officer_dashboard Edit grant already lets it edit a submitted form,
// so it needs the view to reach that list in the first place.
const OPERATIONS_MANAGER: PermissionKey[] = ["overview", "supervisor_dashboard", "department_requests", "purchaser_dashboard", "ap_officer_dashboard", "submitted_payment_requests"];

export const BUILT_IN_ROLES: Array<{ name: string; label: string; permissions: PermissionKey[] }> = [
  { name: "staff", label: "Staff", permissions: STAFF },
  { name: "secretary", label: "Secretary", permissions: SECRETARY },
  { name: "supervisor", label: "Supervisor", permissions: SUPERVISOR },
  { name: "manager", label: "Manager", permissions: MANAGER },
  { name: "custodian", label: "Custodian", permissions: CUSTODIAN },
  { name: "director", label: "Director", permissions: DIRECTOR },
  { name: "purchaser", label: "Purchaser", permissions: PURCHASER },
  { name: "ap_officer", label: "AP Officer", permissions: AP_OFFICER },
  { name: "operations_manager", label: "Operations Manager", permissions: OPERATIONS_MANAGER },
  { name: "admin", label: "Admin", permissions: ALL_PERMISSIONS },
];

/**
 * Seeds the 7-now-10 built-in roles (is_system=true) and their page-permission
 * grants. Idempotent: an existing role or (role_id, permission_key) grant is
 * left untouched, never overwritten or duplicated — safe to call from both a
 * brand new install and a repeat run against one that already has some or
 * all of this data. Assumes the roles/role_permissions tables already exist
 * (see database/tables.ts's TABLE_STATEMENTS).
 */
export async function seedBuiltInRoles(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  for (const role of BUILT_IN_ROLES) {
    const inserted = await pool.query(
      `INSERT INTO roles (name, label, is_system, created_at)
       SELECT $1, $2, TRUE, $3
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(name) = lower($1))
       RETURNING id`,
      [role.name, role.label, now]
    );
    const roleId: number = inserted.rows[0]?.id
      ?? (await pool.query("SELECT id FROM roles WHERE lower(name) = lower($1)", [role.name])).rows[0].id;
    console.log(`OK: role "${role.name}" (${inserted.rowCount ? "created" : "already present"}, id=${roleId})`);

    let grantedCount = 0;
    for (const key of role.permissions) {
      const result = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, can_edit, created_at)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_key = $2
         )`,
        [roleId, key, EDIT_BY_DEFAULT.has(key), now]
      );
      grantedCount += result.rowCount ?? 0;
    }
    console.log(`   permissions: ${grantedCount} of ${role.permissions.length} granted (rest already present)`);
  }
}
