/**
 * ARCH: The indexes declared in schema.ts, as runnable SQL.
 *
 * Single source for both `npm run init-db` (fresh database) and
 * `npm run migrate:add-indexes` (existing database). They used to keep separate
 * lists, which is how item_issuance_audits ended up indexed in one and not the
 * other. Names must match schema.ts exactly, or drizzle considers them missing.
 */
export const INDEX_STATEMENTS: Array<{ label: string; sql: string }> = [
  { label: "item_requests.department", sql: "CREATE INDEX IF NOT EXISTS item_requests_department_idx ON item_requests (department)" },
  { label: "item_requests.status", sql: "CREATE INDEX IF NOT EXISTS item_requests_status_idx ON item_requests (status)" },
  { label: "item_requests.supervisor_status", sql: "CREATE INDEX IF NOT EXISTS item_requests_supervisor_status_idx ON item_requests (supervisor_status)" },
  { label: "item_requests.custodian_status", sql: "CREATE INDEX IF NOT EXISTS item_requests_custodian_status_idx ON item_requests (custodian_status)" },
  { label: "item_requests.created_by", sql: "CREATE INDEX IF NOT EXISTS item_requests_created_by_idx ON item_requests (created_by)" },
  { label: "item_request_items.request_id", sql: "CREATE INDEX IF NOT EXISTS item_request_items_request_id_idx ON item_request_items (request_id)" },
  { label: "item_issuance_audits.item_request_item_id", sql: "CREATE INDEX IF NOT EXISTS item_issuance_audits_item_request_item_id_idx ON item_issuance_audits (item_request_item_id)" },
  { label: "item_issuance_audits.request_id", sql: "CREATE INDEX IF NOT EXISTS item_issuance_audits_request_id_idx ON item_issuance_audits (request_id)" },
  { label: "service_requests.department", sql: "CREATE INDEX IF NOT EXISTS service_requests_department_idx ON service_requests (department)" },
  { label: "service_requests.status", sql: "CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests (status)" },
  { label: "service_requests.supervisor_status", sql: "CREATE INDEX IF NOT EXISTS service_requests_supervisor_status_idx ON service_requests (supervisor_status)" },
  { label: "service_requests.custodian_status", sql: "CREATE INDEX IF NOT EXISTS service_requests_custodian_status_idx ON service_requests (custodian_status)" },
  { label: "service_requests.created_by", sql: "CREATE INDEX IF NOT EXISTS service_requests_created_by_idx ON service_requests (created_by)" },
  { label: "service_items.service_request_id", sql: "CREATE INDEX IF NOT EXISTS service_items_service_request_id_idx ON service_items (service_request_id)" },
  { label: "item_status.request_id", sql: "CREATE INDEX IF NOT EXISTS item_status_request_id_idx ON item_status (request_id)" },
  { label: "service_status.request_id", sql: "CREATE INDEX IF NOT EXISTS service_status_request_id_idx ON service_status (request_id)" },
  { label: "deletion_log.request_type", sql: "CREATE INDEX IF NOT EXISTS deletion_log_request_type_idx ON deletion_log (request_type)" },
  { label: "deletion_log.deleted_at", sql: "CREATE INDEX IF NOT EXISTS deletion_log_deleted_at_idx ON deletion_log (deleted_at)" },
  { label: "adjustment_log.request_id", sql: "CREATE INDEX IF NOT EXISTS adjustment_log_request_id_idx ON adjustment_log (request_id)" },
  { label: "adjustment_log.adjusted_at", sql: "CREATE INDEX IF NOT EXISTS adjustment_log_adjusted_at_idx ON adjustment_log (adjusted_at)" },
  { label: "adjustment_log.adjustment_serial", sql: "CREATE INDEX IF NOT EXISTS adjustment_log_adjustment_serial_idx ON adjustment_log (adjustment_serial)" },
  { label: "option_lists.kind", sql: "CREATE INDEX IF NOT EXISTS option_lists_kind_idx ON option_lists (kind)" },
  // Case-insensitive: "PC" and "pc" are the same option. Enforced here rather
  // than in the controller so a race between two concurrent adds can't slip
  // a duplicate through.
  { label: "option_lists.kind_value_unique", sql: "CREATE UNIQUE INDEX IF NOT EXISTS option_lists_kind_value_unique_idx ON option_lists (kind, upper(value))" },
  { label: "role_permissions.role_id", sql: "CREATE INDEX IF NOT EXISTS role_permissions_role_id_idx ON role_permissions (role_id)" },
  // Case-insensitive: a custom role named "Staff" must collide with the
  // built-in "staff" (and with any other custom role differing only in
  // case) — roles.name's own UNIQUE constraint is case-sensitive and
  // wouldn't catch that on its own.
  { label: "roles.name_lower_unique", sql: "CREATE UNIQUE INDEX IF NOT EXISTS roles_name_lower_unique_idx ON roles (lower(name))" },
  { label: "urgent_requests.department", sql: "CREATE INDEX IF NOT EXISTS urgent_requests_department_idx ON urgent_requests (department)" },
  { label: "urgent_requests.supervisor_status", sql: "CREATE INDEX IF NOT EXISTS urgent_requests_supervisor_status_idx ON urgent_requests (supervisor_status)" },
  { label: "urgent_requests.stockroom_status", sql: "CREATE INDEX IF NOT EXISTS urgent_requests_stockroom_status_idx ON urgent_requests (stockroom_status)" },
  { label: "urgent_request_items.request_id", sql: "CREATE INDEX IF NOT EXISTS urgent_request_items_request_id_idx ON urgent_request_items (request_id)" },
  { label: "payment_request_forms.urgent_request_id", sql: "CREATE INDEX IF NOT EXISTS payment_request_forms_urgent_request_id_idx ON payment_request_forms (urgent_request_id)" },
  { label: "item_payment_request_forms.item_request_id", sql: "CREATE INDEX IF NOT EXISTS item_payment_request_forms_item_request_id_idx ON item_payment_request_forms (item_request_id)" },
  { label: "reimbursement_requests.department", sql: "CREATE INDEX IF NOT EXISTS reimbursement_requests_department_idx ON reimbursement_requests (department)" },
  { label: "reimbursement_requests.supervisor_status", sql: "CREATE INDEX IF NOT EXISTS reimbursement_requests_supervisor_status_idx ON reimbursement_requests (supervisor_status)" },
  { label: "reimbursement_requests.purchaser_status", sql: "CREATE INDEX IF NOT EXISTS reimbursement_requests_purchaser_status_idx ON reimbursement_requests (purchaser_status)" },
  { label: "reimbursement_requests.ap_status", sql: "CREATE INDEX IF NOT EXISTS reimbursement_requests_ap_status_idx ON reimbursement_requests (ap_status)" },
  { label: "reimbursement_items.request_id", sql: "CREATE INDEX IF NOT EXISTS reimbursement_items_request_id_idx ON reimbursement_items (request_id)" },
];
