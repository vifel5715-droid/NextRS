import "server-only";

import { like } from "drizzle-orm";
import { type AuthorizedUser } from "@/lib/auth";
import type { getDb } from "@/lib/db";
import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";
import { adjustmentLog } from "@/db/schema";

export type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Next "ADJ-<year>-NNNNNN" reference, serialized per year with an advisory lock. */
export async function nextAdjustmentSerial(tx: Transaction, year = new Date().getFullYear()): Promise<string> {
  await lockSerialSequence(tx, `adjustment-serial-${year}`);
  const prefix = `ADJ-${year}-`;
  const rows = await tx
    .select({ adjustment_serial: adjustmentLog.adjustment_serial })
    .from(adjustmentLog)
    .where(like(adjustmentLog.adjustment_serial, `${prefix}%`));
  return nextSerial(prefix, rows.map((row) => row.adjustment_serial));
}

/**
 * Writes one adjustment_log row per changed field. `changes` is
 * [field label, before, after]; unchanged pairs are dropped here so a
 * spoofed remarks string with no real change writes nothing.
 */
export async function logAdjustments(
  tx: Transaction,
  args: {
    user: AuthorizedUser;
    requestId: number;
    requestType: "item" | "service";
    requestSerial: string;
    department: string;
    itemLabel: string;
    remarks: string;
    changes: Array<[string, string, string]>;
    adjustmentSerial?: string;
  }
): Promise<string | null> {
  const changes = args.changes.filter(([, before, after]) => before !== after);
  if (!args.remarks || changes.length === 0) return null;
  const adjustmentSerial = args.adjustmentSerial ?? (await nextAdjustmentSerial(tx));
  const now = new Date().toISOString();
  await tx.insert(adjustmentLog).values(
    changes.map(([field, before, after]) => ({
      adjustment_serial: adjustmentSerial,
      request_id: args.requestId,
      request_type: args.requestType,
      request_serial: args.requestSerial,
      department: args.department,
      item_label: args.itemLabel,
      field,
      before_value: before,
      after_value: after,
      adjustment_remarks: args.remarks,
      adjusted_by: args.user.id,
      adjusted_by_name: args.user.name,
      adjusted_by_role: args.user.role,
      adjusted_by_department: args.user.department,
      adjusted_at: now,
    }))
  );
  return adjustmentSerial;
}
