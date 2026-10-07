/**
 * ARCH: Client mirror of server/src/lib/permissionKeys.ts — keep both in
 * sync by hand (no shared package between the two workspaces). This is the
 * fixed set of page/feature permission keys shown as checkboxes when an
 * admin creates or edits a role.
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
