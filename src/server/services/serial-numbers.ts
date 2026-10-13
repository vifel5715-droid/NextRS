import { sql } from "drizzle-orm";

/**
 * Human-facing serial numbers ("IRS-2026-000042", "RMB-2026-000007", ...).
 *
 * Allocation, inside the transaction that inserts the row:
 *   1. lockSerialSequence(tx, key) — a transaction-scoped advisory lock per
 *      sequence and year, so two concurrent creates can't compute the same
 *      next number; released automatically at commit/rollback.
 *   2. Read the existing serials with that prefix and call nextSerial().
 * The column's UNIQUE constraint remains the final guard.
 */
export const SERIAL_DIGITS = 6;

/** Highest trailing number among `existing` + 1, zero-padded onto `prefix`. Gaps are never reused. */
export function nextSerial(prefix: string, existing: ReadonlyArray<string | null | undefined>): string {
  const highest = existing.reduce<number>((maximum, serial) => {
    const match = serial ? /-(\d+)$/.exec(serial) : null;
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(SERIAL_DIGITS, "0")}`;
}

interface SqlExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

export async function lockSerialSequence(tx: SqlExecutor, lockKey: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}
