/**
 * ARCH: The CREATE TABLE statements, as runnable SQL.
 *
 * Shared by `npm run init-db` and the test harness, so tests run against the
 * same schema the application boots with rather than a hand-copied one that
 * quietly drifts. Same reasoning as db/indexes.ts.
 *
 * Kept as raw SQL (not drizzle push) because the project boots against a live
 * Neon Postgres instance and IF NOT EXISTS is the safest idempotent starter.
 */
export const TABLE_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "departments",
    sql: `
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      )`,
  },
  {
    label: "users",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        created_at TEXT NOT NULL,
        session_version INTEGER NOT NULL DEFAULT 0
      )`,
  },
  {
    label: "item_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS item_requests (
        id SERIAL PRIMARY KEY,
        serial TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        created_by UUID NOT NULL,
        requested_by TEXT,
        purpose TEXT NOT NULL,
        remarks TEXT,
        status TEXT NOT NULL,
        supervisor_status TEXT,
        supervisor_approved_by UUID,
        supervisor_approved_at TEXT,
        custodian_status TEXT,
        custodian_approved_by UUID,
        custodian_approved_at TEXT,
        rejection_comment TEXT,
        request_type TEXT NOT NULL,
        attachment TEXT,
        attachment_name TEXT,
        attachment_data BYTEA,
        attachment_mime TEXT,
        attachment_size INTEGER,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "item_request_items",
    sql: `
      CREATE TABLE IF NOT EXISTS item_request_items (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        uom TEXT NOT NULL,
        remarks TEXT,
        machine_code TEXT,
        issuance_number TEXT,
        pr_number TEXT,
        delivery_status TEXT,
        quantity_delivered INTEGER,
        quantity_out INTEGER,
        qty_balance INTEGER NOT NULL DEFAULT 0,
        pr_status TEXT,
        pr_type TEXT,
        hold_edited BOOLEAN NOT NULL DEFAULT FALSE,
        date_needed TEXT,
        purchasing_transaction TEXT,
        amount NUMERIC(12, 2),
        is_inventoriable BOOLEAN NOT NULL DEFAULT FALSE,
        catalog_item_name TEXT,

        CONSTRAINT fk_item_request
          FOREIGN KEY (request_id)
          REFERENCES item_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "item_issuance_audits",
    sql: `
      CREATE TABLE IF NOT EXISTS item_issuance_audits (
        id SERIAL PRIMARY KEY,
        item_request_item_id INTEGER NOT NULL,
        request_id INTEGER NOT NULL,
        issuance_number TEXT NOT NULL,
        transaction_type TEXT,
        quantity_issued INTEGER NOT NULL,
        remaining_balance INTEGER NOT NULL,
        custodian_id UUID NOT NULL,
        custodian_name TEXT NOT NULL,
        issued_at TEXT NOT NULL,

        CONSTRAINT fk_item_request_item
          FOREIGN KEY (item_request_item_id)
          REFERENCES item_request_items(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_issuance_request
          FOREIGN KEY (request_id)
          REFERENCES item_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "service_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS service_requests (
        id SERIAL PRIMARY KEY,
        serial TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        created_by UUID NOT NULL,
        requested_by TEXT,
        purpose TEXT NOT NULL,
        remarks TEXT,
        status TEXT NOT NULL,
        supervisor_status TEXT,
        supervisor_approved_by UUID,
        supervisor_approved_at TEXT,
        custodian_status TEXT,
        custodian_approved_by UUID,
        custodian_approved_at TEXT,
        rejection_comment TEXT,
        pr_number TEXT,
        pr_status TEXT,
        pr_number_updated_by UUID,
        pr_number_updated_at TEXT,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "service_items",
    sql: `
      CREATE TABLE IF NOT EXISTS service_items (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        delivery_status TEXT,
        pr_number TEXT,
        pr_status TEXT,
        receiving_report_no TEXT,
        receiving_report_no_updated_by UUID,
        receiving_report_no_updated_at TEXT,
        hold_edited BOOLEAN NOT NULL DEFAULT FALSE,

        CONSTRAINT fk_service_request
          FOREIGN KEY (service_request_id)
          REFERENCES service_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "item_status",
    sql: `
      CREATE TABLE IF NOT EXISTS item_status (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        request_type TEXT NOT NULL,
        issuance_number TEXT,
        pr_number TEXT,
        delivery_status TEXT,
        quantity_delivered INTEGER,
        status TEXT NOT NULL,
        updated_by UUID NOT NULL,
        updated_at TEXT NOT NULL,

        CONSTRAINT fk_item_status_request
          FOREIGN KEY (request_id)
          REFERENCES item_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "service_status",
    sql: `
      CREATE TABLE IF NOT EXISTS service_status (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        request_type TEXT NOT NULL,
        pr_number TEXT,
        status TEXT NOT NULL,
        updated_by UUID NOT NULL,
        updated_at TEXT NOT NULL,

        CONSTRAINT fk_service_status_request
          FOREIGN KEY (request_id)
          REFERENCES service_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "deletion_log",
    sql: `
      CREATE TABLE IF NOT EXISTS deletion_log (
        id SERIAL PRIMARY KEY,
        request_type TEXT NOT NULL,
        request_id INTEGER,
        request_serial TEXT NOT NULL,
        department TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        quantity INTEGER,
        uom TEXT,
        issued_by_name TEXT,
        reason TEXT NOT NULL,
        deleted_by UUID NOT NULL,
        deleted_at TEXT NOT NULL,
        recovered_at TEXT,
        recovered_by UUID
      )`,
  },
  {
    label: "adjustment_log",
    sql: `
      CREATE TABLE IF NOT EXISTS adjustment_log (
        id SERIAL PRIMARY KEY,
        adjustment_serial TEXT,
        request_id INTEGER,
        request_type TEXT NOT NULL DEFAULT 'item',
        request_serial TEXT NOT NULL,
        department TEXT NOT NULL,
        item_label TEXT NOT NULL,
        field TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        adjustment_remarks TEXT NOT NULL,
        adjusted_by UUID NOT NULL,
        adjusted_by_name TEXT NOT NULL,
        adjusted_by_role TEXT NOT NULL,
        adjusted_by_department TEXT NOT NULL,
        adjusted_at TEXT NOT NULL
      )`,
  },
  {
    label: "item_catalog",
    sql: `
      CREATE TABLE IF NOT EXISTS item_catalog (
        id SERIAL PRIMARY KEY,
        item_name TEXT NOT NULL,
        item_type TEXT,
        uom TEXT NOT NULL,
        machine_code TEXT,
        item_group TEXT,
        approval_level TEXT NOT NULL DEFAULT 'SUPERVISOR_OR_MANAGER',
        departments TEXT,
        created_by UUID,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "option_lists",
    sql: `
      CREATE TABLE IF NOT EXISTS option_lists (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        created_by UUID,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "roles",
    sql: `
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "role_permissions",
    sql: `
      CREATE TABLE IF NOT EXISTS role_permissions (
        id SERIAL PRIMARY KEY,
        role_id INTEGER NOT NULL,
        permission_key TEXT NOT NULL,
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL,

        CONSTRAINT fk_role
          FOREIGN KEY (role_id)
          REFERENCES roles(id)
          ON DELETE CASCADE,
        CONSTRAINT role_permissions_role_key_unique
          UNIQUE (role_id, permission_key)
      )`,
  },
  {
    label: "urgent_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS urgent_requests (
        id SERIAL PRIMARY KEY,
        serial TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        created_by UUID NOT NULL,
        requested_by TEXT,
        purpose TEXT NOT NULL,
        remarks TEXT,
        date_needed TEXT,
        supervisor_status TEXT NOT NULL DEFAULT 'pending',
        supervisor_approved_by UUID,
        supervisor_approved_at TEXT,
        stockroom_status TEXT NOT NULL DEFAULT 'pending',
        stockroom_approved_by UUID,
        stockroom_approved_at TEXT,
        rejection_comment TEXT,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "urgent_request_items",
    sql: `
      CREATE TABLE IF NOT EXISTS urgent_request_items (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        item_description TEXT NOT NULL,
        quantity INTEGER,
        uom TEXT,
        is_inventoriable BOOLEAN NOT NULL DEFAULT FALSE,
        purchasing_transaction TEXT,
        amount NUMERIC(12, 2),
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        quantity_delivered INTEGER,
        delivered_by UUID,
        delivered_at TEXT,
        catalog_item_name TEXT,
        created_at TEXT NOT NULL,

        CONSTRAINT fk_urgent_request
          FOREIGN KEY (request_id)
          REFERENCES urgent_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "payment_request_forms",
    sql: `
      CREATE TABLE IF NOT EXISTS payment_request_forms (
        id SERIAL PRIMARY KEY,
        urgent_request_id INTEGER NOT NULL UNIQUE,
        payee TEXT,
        department TEXT,
        date TEXT,
        date_needed TEXT,
        note TEXT,
        prepared_by TEXT,
        checked_by TEXT,
        approved_by TEXT,
        total_amount_due NUMERIC(12, 2),
        submitted BOOLEAN NOT NULL DEFAULT FALSE,
        submitted_by UUID,
        submitted_at TEXT,
        created_by UUID NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        CONSTRAINT fk_payment_request_form_urgent_request
          FOREIGN KEY (urgent_request_id)
          REFERENCES urgent_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "item_payment_request_forms",
    sql: `
      CREATE TABLE IF NOT EXISTS item_payment_request_forms (
        id SERIAL PRIMARY KEY,
        item_request_id INTEGER NOT NULL UNIQUE,
        payee TEXT,
        department TEXT,
        date TEXT,
        date_needed TEXT,
        note TEXT,
        prepared_by TEXT,
        checked_by TEXT,
        approved_by TEXT,
        total_amount_due NUMERIC(12, 2),
        submitted BOOLEAN NOT NULL DEFAULT FALSE,
        submitted_by UUID,
        submitted_at TEXT,
        created_by UUID NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        CONSTRAINT fk_item_payment_request_form_item_request
          FOREIGN KEY (item_request_id)
          REFERENCES item_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "reimbursement_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS reimbursement_requests (
        id SERIAL PRIMARY KEY,
        serial TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL,
        created_by UUID NOT NULL,
        requested_by TEXT,
        purpose TEXT NOT NULL,
        remarks TEXT,
        date_needed TEXT,
        supplier TEXT NOT NULL,
        attachment_name TEXT,
        attachment_data BYTEA,
        attachment_size INTEGER,
        supervisor_status TEXT NOT NULL DEFAULT 'pending',
        supervisor_approved_by UUID,
        supervisor_approved_at TEXT,
        purchaser_status TEXT NOT NULL DEFAULT 'pending',
        purchaser_approved_by UUID,
        purchaser_approved_at TEXT,
        ap_status TEXT NOT NULL DEFAULT 'pending',
        ap_approved_by UUID,
        ap_approved_at TEXT,
        closed_by UUID,
        closed_at TEXT,
        rejection_comment TEXT,
        created_at TEXT NOT NULL
      )`,
  },
  {
    label: "reimbursement_items",
    sql: `
      CREATE TABLE IF NOT EXISTS reimbursement_items (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        item_description TEXT NOT NULL,
        quantity INTEGER,
        uom TEXT,
        amount NUMERIC(12, 2) NOT NULL,
        created_at TEXT NOT NULL,

        CONSTRAINT fk_reimbursement_request
          FOREIGN KEY (request_id)
          REFERENCES reimbursement_requests(id)
          ON DELETE CASCADE
      )`,
  },
  {
    label: "petty_cash_transactions",
    sql: `
      CREATE TABLE IF NOT EXISTS petty_cash_transactions (
        id SERIAL PRIMARY KEY,
        serial TEXT NOT NULL UNIQUE,
        po_number TEXT NOT NULL,
        total_amount NUMERIC(12, 2) NOT NULL,
        cash_received NUMERIC(12, 2),
        cash_received_at TEXT,
        receiver_name TEXT,
        created_by UUID NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  },
  {
    label: "failed_login_attempts",
    sql: `
      CREATE TABLE IF NOT EXISTS failed_login_attempts (
        id BIGSERIAL PRIMARY KEY,
        username_key TEXT NOT NULL,
        ip_address TEXT,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
  {
    label: "audit_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id UUID,
        actor_name TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        department TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
];
