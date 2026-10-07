/**
 * ARCH: moves item_requests attachments off disk and into Postgres (bytea).
 * Run via `npm run migrate:attachment-storage`. Idempotent — safe to re-run.
 *
 * 1. Adds attachment_data/attachment_mime/attachment_size (IF NOT EXISTS).
 * 2. Best-effort backfill: any row still pointing at a legacy on-disk file
 *    (attachment_name set, attachment_data still empty) gets its file read
 *    from server/uploads and pushed into attachment_data. Rows whose file no
 *    longer exists (a prior deploy without a persistent disk already lost
 *    it) are left as-is — they were already unrecoverable before this
 *    migration, not made worse by it.
 */
import { Pool } from "pg";
import path from "path";
import fs from "fs/promises";
import { env } from "../../config/env.js";
import { UPLOADS_DIR } from "../../middleware/upload.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query("ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_data BYTEA");
    await pool.query("ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_mime TEXT");
    await pool.query("ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_size INTEGER");
    console.log("OK: item_requests.attachment_data / attachment_mime / attachment_size (added or already present)");

    const { rows } = await pool.query<{ id: number; attachment: string; attachment_name: string | null }>(
      `SELECT id, attachment, attachment_name FROM item_requests
       WHERE attachment IS NOT NULL AND attachment_data IS NULL`
    );

    if (rows.length === 0) {
      console.log("No legacy on-disk attachments to migrate.");
    } else {
      console.log(`Found ${rows.length} legacy attachment(s) to migrate from disk...`);
      let migrated = 0;
      let missing = 0;
      for (const row of rows) {
        const filePath = path.join(UPLOADS_DIR, row.attachment);
        try {
          const buffer = await fs.readFile(filePath);
          await pool.query(
            `UPDATE item_requests
             SET attachment_data = $1, attachment_mime = 'application/pdf', attachment_size = $2
             WHERE id = $3`,
            [buffer, buffer.length, row.id]
          );
          migrated++;
        } catch {
          console.warn(`  skip request #${row.id}: file not found on disk (${row.attachment})`);
          missing++;
        }
      }
      console.log(`Migrated ${migrated} attachment(s), ${missing} already missing from disk.`);
    }

    console.log("\nAttachment storage migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
