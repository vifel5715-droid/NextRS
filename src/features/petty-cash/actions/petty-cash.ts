"use server";

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { PettyCashTransaction } from "@/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser, type AuthorizedUser } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import {
  asRecord,
  assertId,
  moneyString,
  optionalString,
  requiredString,
} from "@/lib/validation";
import { nextAdjustmentSerial, type Transaction } from "@/server/audit/adjustments";
import { getDb } from "@/lib/db";
import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";
import { adjustmentLog, pettyCashTransactions, users } from "@/db/schema";
import { publishRequestChanged } from "@/lib/realtime";

/**
 * ARCH: Petty Cash ledger (no approval chain). Custodian and AP Officer both
 * create entries and edit PO Number / Total Amount; Cash Received, its date,
 * and the Receiver Name are AP Officer's (or admin's) alone. Every create/edit
 * is written to adjustment_log (request_type "petty_cash"), which is what the
 * page's Adjustment History modal reads.
 */
const DUPLICATE_WINDOW_MS = 30_000;
const isAPOfficer = (user: AuthorizedUser) => user.roleKey === "ap_officer" || user.roleKey === "admin";

async function logPettyCash(
  tx: Transaction,
  user: AuthorizedUser,
  row: { id: number; serial: string },
  remarks: string,
  changes: Array<[string, string, string]>
) {
  const real = changes.filter(([, before, after]) => before !== after);
  if (real.length === 0) return;
  const serial = await nextAdjustmentSerial(tx);
  const now = new Date().toISOString();
  await tx.insert(adjustmentLog).values(
    real.map(([field, before, after]) => ({
      adjustment_serial: serial,
      request_id: row.id,
      request_type: "petty_cash",
      request_serial: row.serial,
      department: user.department,
      item_label: `Petty Cash ${row.serial}`,
      field,
      before_value: before,
      after_value: after,
      adjustment_remarks: remarks,
      adjusted_by: user.id,
      adjusted_by_name: user.name,
      adjusted_by_role: user.role,
      adjusted_by_department: user.department,
      adjusted_at: now,
    }))
  );
}

export async function getPettyCashTransactionsAction(): Promise<ActionResult<PettyCashTransaction[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    const db = getDb();
    const rows = await db.select().from(pettyCashTransactions).orderBy(desc(pettyCashTransactions.created_at));
    const creatorIds = [...new Set(rows.map((row) => row.created_by))];
    const creators = creatorIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds))
      : [];
    const nameById = new Map(creators.map((creator) => [creator.id, creator.name]));
    return rows.map((row) => ({ ...row, created_by_name: nameById.get(row.created_by) ?? null }));
  });
}

export async function createPettyCashTransactionAction(value: unknown): Promise<ActionResult<{ id: number; serial: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    const input = asRecord(value);
    const poNumber = requiredString(input, "po_number", 100, "PO Number").toUpperCase();
    const totalAmount = moneyString(input.total_amount, "Total Amount");

    const now = new Date();
    const year = now.getFullYear();
    const created = await getDb().transaction(async (tx) => {
      await lockSerialSequence(tx, `petty-cash-serial-${year}`);
      const [duplicate] = await tx
        .select({ serial: pettyCashTransactions.serial })
        .from(pettyCashTransactions)
        .where(
          and(
            eq(pettyCashTransactions.created_by, user.id),
            eq(pettyCashTransactions.po_number, poNumber),
            eq(pettyCashTransactions.total_amount, totalAmount),
            gte(pettyCashTransactions.created_at, new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString())
          )
        )
        .limit(1);
      if (duplicate) throw new Error(`This transaction was already recorded as ${duplicate.serial}.`);

      const serials = await tx
        .select({ serial: pettyCashTransactions.serial })
        .from(pettyCashTransactions)
        .where(sql`${pettyCashTransactions.serial} LIKE ${`PC-${year}-%`}`);
      const serial = nextSerial(`PC-${year}-`, serials.map((row) => row.serial));
      const [row] = await tx
        .insert(pettyCashTransactions)
        .values({
          serial,
          po_number: poNumber,
          total_amount: totalAmount,
          created_by: user.id,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .returning({ id: pettyCashTransactions.id, serial: pettyCashTransactions.serial });
      await logPettyCash(tx, user, row, "Created", [
        ["PO Number", "", poNumber],
        ["Total Amount", "", totalAmount],
      ]);
      return row;
    });
    await publishRequestChanged({ type: "petty_cash", action: "created", id: created.id, department: null });
    return created;
  });
}

export async function updatePettyCashTransactionAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    assertId(id, "transaction ID");
    const input = asRecord(value);
    const poNumber = optionalString(input, "po_number", 100, "PO Number");
    if (poNumber !== undefined && !poNumber) throw new Error("PO Number is required.");
    const totalAmount = input.total_amount === undefined ? undefined : moneyString(input.total_amount, "Total Amount");
    const touchesCash = input.cash_received !== undefined || input.receiver_name !== undefined;
    if (touchesCash && !isAPOfficer(user)) throw new Error("Only AP Officer can record Cash Received.");
    const cashReceived = input.cash_received === undefined ? undefined : moneyString(input.cash_received, "Cash Received");
    const receiverName = optionalString(input, "receiver_name", 200, "Receiver Name");

    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, id)).for("update");
      if (!row) throw new Error("Petty Cash transaction not found.");
      const now = new Date().toISOString();
      const patch: Partial<typeof pettyCashTransactions.$inferInsert> = { updated_at: now };
      if (poNumber) patch.po_number = poNumber.toUpperCase();
      if (totalAmount !== undefined) patch.total_amount = totalAmount;
      if (cashReceived !== undefined) {
        patch.cash_received = cashReceived;
        // Recorded automatically when the cash is first entered.
        if (row.cash_received !== cashReceived || !row.cash_received_at) patch.cash_received_at = now.slice(0, 10);
      }
      if (receiverName !== undefined) patch.receiver_name = receiverName ? receiverName.toUpperCase() : null;

      await tx.update(pettyCashTransactions).set(patch).where(eq(pettyCashTransactions.id, id));
      await logPettyCash(tx, user, row, "Edited", [
        ["PO Number", row.po_number, patch.po_number ?? row.po_number],
        ["Total Amount", row.total_amount, patch.total_amount ?? row.total_amount],
        ["Cash Received", row.cash_received ?? "", patch.cash_received ?? row.cash_received ?? ""],
        ["Receiver Name", row.receiver_name ?? "", patch.receiver_name === undefined ? row.receiver_name ?? "" : patch.receiver_name ?? ""],
      ]);
    });
    await publishRequestChanged({ type: "petty_cash", action: "updated", id, department: null });
  });
}

/** Name of Receiver suggestions — the custodians who hand out petty cash. */
export async function getPettyCashCustodianNamesAction(): Promise<ActionResult<string[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    const rows = await getDb()
      .select({ name: users.name })
      .from(users)
      .where(sql`lower(${users.role}) = 'custodian'`)
      .orderBy(asc(users.name));
    return rows.map((row) => row.name);
  });
}
