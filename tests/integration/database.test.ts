/**
 * Integration tests against a real, disposable PostgreSQL database.
 *
 *   TEST_DATABASE_URL=postgresql://.../RS_DB_TEST npm run test:integration
 *
 * Skipped when TEST_DATABASE_URL is unset. Refuses to run against the
 * DATABASE_URL the app uses, so they can never touch real data. The schema
 * is created with the same initializer as `npm run db:setup`.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { initializeDatabaseSchema } from "@/db/bootstrap";

const TEST_URL = process.env.TEST_DATABASE_URL;
const enabled = Boolean(TEST_URL);
if (enabled && TEST_URL === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must point at a separate, disposable database — not DATABASE_URL.");
}

const pool = enabled ? new Pool({ connectionString: TEST_URL }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

// The throttle service reads the database through @/lib/db; point it at the test pool.
jest.mock("@/lib/db", () => ({ getDb: () => db }));

import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";
import { recordAudit } from "@/server/audit/audit-log";
import { checkLoginThrottle, clearLoginFailures, recordLoginFailure } from "@/server/services/login-throttle";
import { MAX_FAILURES_PER_USERNAME } from "@/server/policies/login-throttle-policy";

const run = enabled ? describe : describe.skip;
const PREFIX = `TEST-${Date.now()}-`;

run("database integration", () => {
  const consoleLog = jest.spyOn(console, "log");
  beforeAll(async () => {
    consoleLog.mockImplementation(() => {});
    await initializeDatabaseSchema(pool!);
    consoleLog.mockRestore();
  }, 60_000);

  afterAll(async () => {
    await db!.delete(schema.pettyCashTransactions).where(like(schema.pettyCashTransactions.serial, `${PREFIX}%`));
    await db!.delete(schema.failedLoginAttempts).where(like(schema.failedLoginAttempts.username_key, "itest-%"));
    await db!.delete(schema.auditLogs).where(eq(schema.auditLogs.entity_type, "integration_test"));
    await pool!.end();
  });

  async function insertWithSerial(): Promise<string> {
    return db!.transaction(async (tx) => {
      await lockSerialSequence(tx, `itest-serial-${PREFIX}`);
      const rows = await tx
        .select({ serial: schema.pettyCashTransactions.serial })
        .from(schema.pettyCashTransactions)
        .where(like(schema.pettyCashTransactions.serial, `${PREFIX}%`));
      const serial = nextSerial(PREFIX, rows.map((row) => row.serial));
      // Widen the race window: without the advisory lock, concurrent callers
      // would all read the same max and collide on the UNIQUE constraint.
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
      const now = new Date().toISOString();
      await tx.insert(schema.pettyCashTransactions).values({
        serial,
        po_number: "PO-ITEST",
        total_amount: "1.00",
        created_by: "00000000-0000-4000-8000-000000000000",
        created_at: now,
        updated_at: now,
      });
      return serial;
    });
  }

  it("allocates distinct, consecutive serials under concurrency", async () => {
    const serials = await Promise.all(Array.from({ length: 8 }, () => insertWithSerial()));
    expect(new Set(serials).size).toBe(8);
    expect([...serials].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `${PREFIX}${String(i + 1).padStart(6, "0")}`));
  });

  it("rolls back the audit entry together with a failed business change", async () => {
    await expect(
      db!.transaction(async (tx) => {
        await recordAudit(tx, { action: "role.updated", entityType: "integration_test", entityId: "rollback" });
        throw new Error("simulated failure after the audit write");
      })
    ).rejects.toThrow("simulated failure");

    const rows = await db!
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entity_id, "rollback"));
    expect(rows).toHaveLength(0);
  });

  it("commits the audit entry with a successful change and redacts secrets", async () => {
    await db!.transaction(async (tx) => {
      await recordAudit(tx, {
        action: "user.updated",
        entityType: "integration_test",
        entityId: "commit",
        details: { username: "jane", password: "should-not-persist" },
      });
    });
    const [row] = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.entity_id, "commit"));
    expect(row.details).toEqual({ username: "jane", password: "[REDACTED]" });
  });

  it("throttles a username after repeated failures and resets on success", async () => {
    const key = `itest-${Date.now()}`;
    for (let i = 0; i < MAX_FAILURES_PER_USERNAME; i += 1) await recordLoginFailure(key, "198.51.100.1");
    const limited = await checkLoginThrottle(key, "198.51.100.2");
    expect(limited.limited).toBe(true);

    await clearLoginFailures(key);
    expect(await checkLoginThrottle(key, "198.51.100.2")).toEqual({ limited: false });
  });
});
