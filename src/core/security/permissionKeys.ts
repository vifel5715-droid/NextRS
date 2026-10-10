/**
 * ARCH: The fixed set of page/feature permission keys a role can be granted
 * (see db/schema.ts's roles/rolePermissions and roles.controller.ts). This
 * is intentionally NOT itself admin-editable — it's the list of checkboxes
 * shown when creating/editing a role, and the allow-list permissionMiddleware
 * validates route-level grants against.
 *
 * Each key maps to exactly one sidebar section / page, mirroring the current
 * hardcoded role arrays in client/src/components/Sidebar.tsx and
 * client/src/App.tsx's route allowedRoles. Built-in role grants are seeded
 * in database/seedRoles.ts to reproduce today's access exactly.
 *
 * Client mirror: client/src/constants/permissions.ts — keep both in sync by
 * hand (no shared package between the two workspaces).
 */
export const PERMISSION_KEYS = [
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
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  overview: "Dashboard Overview",
  create_request: "Create New Request",
  department_requests: "Pending Requests (Custodian/Admin)",
  pending_items_services: "Pending Purchase Items & Services",
  delivered_items: "Delivered Purchase Items",
  item_list: "Item List (incl. Issued List of Item, Held Items)",
  held_items: "Held Items",
  complete_requests: "Completed Requests",
  adjustment_history: "Adjustment History",
  deleted_items: "Deleted",
  supervisor_dashboard: "Supervisor Dashboard",
  purchaser_dashboard: "Purchaser Dashboard",
  urgent_items: "Urgent Item From IRS",
  pending_item_entry: "Pending Item Entry",
  new_item_list: "New Item List",
  ap_officer_dashboard: "AP Officer Dashboard",
  petty_cash: "Petty Cash",
  users_management: "Users Management",
  submitted_payment_requests: "Submitted Payment Request",
};

export const isPermissionKey = (value: string): value is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(value);
