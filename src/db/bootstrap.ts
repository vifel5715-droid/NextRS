import type { Pool } from "pg";
import { INDEX_STATEMENTS } from "./indexes";
import { TABLE_STATEMENTS } from "./tables";

const COLUMN_STATEMENTS = [
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS requested_by TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS rejection_comment TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_name TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_data BYTEA",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_mime TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_size INTEGER",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS supervisor_status TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS supervisor_approved_by UUID",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS supervisor_approved_at TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS custodian_status TEXT",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS custodian_approved_by UUID",
  "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS custodian_approved_at TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS machine_code TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS issuance_number TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_number TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS delivery_status TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS quantity_delivered INTEGER",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS quantity_out INTEGER",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS qty_balance INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_status TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_type TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS hold_edited BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS status_reason TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS date_needed TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS purchasing_transaction TEXT",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS is_inventoriable BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS catalog_item_name TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS requested_by TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejection_comment TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS supervisor_status TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS supervisor_approved_by UUID",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS supervisor_approved_at TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS custodian_status TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS custodian_approved_by UUID",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS custodian_approved_at TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_status TEXT",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number_updated_by UUID",
  "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number_updated_at TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS delivery_status TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS pr_number TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS pr_status TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no_updated_by UUID",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no_updated_at TEXT",
  "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS hold_edited BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE item_issuance_audits ADD COLUMN IF NOT EXISTS transaction_type TEXT",
  "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS recovered_at TEXT",
  "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS recovered_by UUID",
  "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS issued_by_name TEXT",
  "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS adjusted_by_department TEXT",
  "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS adjustment_serial TEXT",
  "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'item'",
  "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS approval_level TEXT NOT NULL DEFAULT 'SUPERVISOR_OR_MANAGER'",
  "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS machine_code TEXT",
  "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS departments TEXT",
  "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS item_group TEXT",
  "ALTER TABLE option_lists ADD COLUMN IF NOT EXISTS description TEXT",
  "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS date_needed TEXT",
  "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_approved_by UUID",
  "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_approved_at TEXT",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS uom TEXT",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS is_inventoriable BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS purchasing_transaction TEXT",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS quantity_delivered INTEGER",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivered_by UUID",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivered_at TEXT",
  "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS catalog_item_name TEXT",
  "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS date_needed TEXT",
  "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS total_amount_due NUMERIC(12, 2)",
  "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted_by UUID",
  "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted_at TEXT",
  "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS date_needed TEXT",
  "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS total_amount_due NUMERIC(12, 2)",
  "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted_by UUID",
  "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted_at TEXT",
  "ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS closed_by UUID",
  "ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS closed_at TEXT",
  "ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS attachment_name TEXT",
  "ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS attachment_data BYTEA",
  "ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS attachment_size INTEGER",
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS serial TEXT",
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS cash_received_at TEXT",
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS receiver_name TEXT",
  // Nullable, no backfill: existing rows stay Pending until someone confirms delivery.
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS delivered_at TEXT",
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS delivered_by UUID",
  // Nullable, no backfill: existing rows start as Cash Status "Not Received".
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS cash_confirmed_at TEXT",
  "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS cash_confirmed_by UUID",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0",
] as const;

async function upgradeLegacyUsersTable(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'email'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'username'
      ) THEN
        ALTER TABLE users RENAME COLUMN email TO username;
      END IF;
    END $$;
  `);
}

async function backfillLegacyData(pool: Pool): Promise<void> {
  // The Pending Purchase Items & Services / Delivered Purchase Items pages
  // were removed — drop their grants so the Roles editor doesn't resend them.
  await pool.query(`
    DELETE FROM role_permissions
    WHERE permission_key IN ('pending_items_services', 'delivered_items')
  `);
  // "ON HOLD" was retired for items in favour of "CANCEL" (with a reason).
  await pool.query(`
    UPDATE item_request_items
    SET delivery_status = 'CANCEL',
        status_reason = COALESCE(NULLIF(TRIM(status_reason), ''), 'Converted from On Hold'),
        hold_edited = FALSE
    WHERE delivery_status = 'HOLD'
  `);
  await pool.query(`
    UPDATE item_request_items i
    SET quantity_out = COALESCE((
      SELECT SUM(a.quantity_issued)
      FROM item_issuance_audits a
      WHERE a.item_request_item_id = i.id AND a.transaction_type = 'OUT'
    ), 0)
    WHERE i.quantity_out IS NULL
  `);
  await pool.query(`
    UPDATE item_request_items
    SET pr_type = delivery_status
    WHERE pr_type IS NULL AND delivery_status IN ('PURCHASE REQUEST', 'PAYMENT REQUEST')
  `);
  await pool.query(`
    UPDATE item_issuance_audits
    SET transaction_type = CASE
      WHEN COALESCE(issuance_number, '') <> '' THEN 'OUT'
      ELSE 'PARTIAL'
    END
    WHERE transaction_type IS NULL
  `);
  await pool.query(`
    UPDATE service_requests SET supervisor_status = 'pending'
    WHERE supervisor_status IS NULL
  `);
  await pool.query(`
    UPDATE service_requests SET custodian_status = 'pending'
    WHERE custodian_status IS NULL
  `);
  await pool.query(`
    UPDATE item_request_items SET delivery_status = 'URGENT'
    WHERE delivery_status = 'PAYMENT REQUEST'
  `);
  await pool.query(`
    UPDATE item_request_items SET pr_type = 'URGENT'
    WHERE pr_type = 'PAYMENT REQUEST'
  `);
  await pool.query(`
    UPDATE item_status SET delivery_status = 'URGENT'
    WHERE delivery_status = 'PAYMENT REQUEST'
  `);
  await pool.query(`
    UPDATE adjustment_log a
    SET adjusted_by_department = COALESCE(u.department, a.department)
    FROM users u
    WHERE a.adjusted_by = u.id AND a.adjusted_by_department IS NULL
  `);
  await pool.query(`
    UPDATE adjustment_log SET adjusted_by_department = department
    WHERE adjusted_by_department IS NULL
  `);
  await pool.query(`
    ALTER TABLE adjustment_log
    ALTER COLUMN adjusted_by_department SET NOT NULL
  `);
}

async function backfillPettyCashSerials(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("LOCK TABLE petty_cash_transactions IN SHARE ROW EXCLUSIVE MODE");
      const { rows: existing } = await client.query<{ serial: string }>(
        "SELECT serial FROM petty_cash_transactions WHERE serial IS NOT NULL AND serial LIKE 'CP-%'"
      );
      const sequenceByYear = new Map<number, number>();

      for (const { serial } of existing) {
        const match = serial.match(/^CP-(\d{4})-(\d+)$/);
        if (!match) continue;
        const year = Number(match[1]);
        sequenceByYear.set(year, Math.max(sequenceByYear.get(year) ?? 0, Number(match[2])));
      }

      const { rows: missing } = await client.query<{ id: number; created_at: string }>(
        "SELECT id, created_at FROM petty_cash_transactions WHERE serial IS NULL ORDER BY created_at ASC, id ASC"
      );
      for (const { id, created_at } of missing) {
        const date = new Date(created_at);
        if (Number.isNaN(date.getTime())) {
          throw new Error(`Cannot generate a petty-cash serial for row ${id}: invalid created_at.`);
        }
        const year = date.getFullYear();
        const next = (sequenceByYear.get(year) ?? 0) + 1;
        sequenceByYear.set(year, next);
        await client.query(
          "UPDATE petty_cash_transactions SET serial = $1 WHERE id = $2",
          [`CP-${year}-${String(next).padStart(6, "0")}`, id]
        );
      }

      await client.query("ALTER TABLE petty_cash_transactions ALTER COLUMN serial SET NOT NULL");
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_index index_info
            JOIN pg_attribute column_info
              ON column_info.attrelid = index_info.indrelid
             AND column_info.attnum = index_info.indkey[0]
            WHERE index_info.indrelid = 'petty_cash_transactions'::regclass
              AND index_info.indisunique
              AND index_info.indisvalid
              AND index_info.indnatts = 1
              AND column_info.attname = 'serial'
          ) THEN
            ALTER TABLE petty_cash_transactions
            ADD CONSTRAINT petty_cash_transactions_serial_unique UNIQUE (serial);
          END IF;
        END $$;
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function addMissingForeignKeys(pool: Pool): Promise<void> {
  const constraints = [
    ["item_request_items", "fk_item_request", "FOREIGN KEY (request_id) REFERENCES item_requests(id) ON DELETE CASCADE"],
    ["service_items", "fk_service_request", "FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE CASCADE"],
    ["item_status", "fk_item_status_request", "FOREIGN KEY (request_id) REFERENCES item_requests(id) ON DELETE CASCADE"],
    ["service_status", "fk_service_status_request", "FOREIGN KEY (request_id) REFERENCES service_requests(id) ON DELETE CASCADE"],
  ] as const;

  for (const [table, name, definition] of constraints) {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = current_schema()
            AND table_name = '${table}'
            AND constraint_name = '${name}'
        ) THEN
          ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition};
        END IF;
      END $$;
    `);
  }
}

export async function initializeDatabaseSchema(pool: Pool): Promise<void> {
  for (const table of TABLE_STATEMENTS) {
    await pool.query(table.sql);
    console.log(`OK: ${table.label} table`);
  }

  await upgradeLegacyUsersTable(pool);
  for (const statement of COLUMN_STATEMENTS) {
    await pool.query(statement);
  }

  await backfillLegacyData(pool);
  await backfillPettyCashSerials(pool);
  await addMissingForeignKeys(pool);

  for (const index of INDEX_STATEMENTS) {
    await pool.query(index.sql);
    console.log(`OK: ${index.label}`);
  }
}
