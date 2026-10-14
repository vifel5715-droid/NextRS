"use server";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
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
 * ARCH: Petty Cash ledger — the Cash Purchase Based on P.O. pages. The
 * Custodian's two statuses are derived from timestamps, no status column:
 *   Cash Status: Received when cash_confirmed_at is set, else Not Received
 *   Item Status: Delivered when delivered_at is set (Delivered Cash
 *                Purchase page), else Pending (Pending Cash Purchase page)
 * AP Officer (or admin) alone creates entries, edits them and submits the
 * Cash Received amount; Custodian (or admin) alone sets the two statuses
 * (setPettyCashCustodianStatusAction). Every change is
 * written to adjustment_log (request_type "petty_cash"), which is what the
 * pages' History modal reads.
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

/**
 * Cash Purchase status rule, used by every list and count below:
 * Pending = delivered_at IS NULL, Delivered = delivered_at IS NOT NULL.
 */
export type CashPurchaseStatus = "pending" | "delivered";
const statusFilter = (status: CashPurchaseStatus) =>
  status === "delivered" ? isNotNull(pettyCashTransactions.delivered_at) : isNull(pettyCashTransactions.delivered_at);

/** Confirming delivery is a stockroom step — Custodian (or admin), not AP Officer. */
const canConfirmDelivery = (user: AuthorizedUser) => user.roleKey === "custodian" || user.roleKey === "admin";

export async function getPettyCashTransactionsAction(
  status?: CashPurchaseStatus
): Promise<ActionResult<PettyCashTransaction[]>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    if (status !== undefined && status !== "pending" && status !== "delivered") throw new Error("Invalid status.");
    const db = getDb();
    const rows = await db
      .select()
      .from(pettyCashTransactions)
      .where(status ? statusFilter(status) : undefined)
      .orderBy(desc(status === "delivered" ? pettyCashTransactions.delivered_at : pettyCashTransactions.created_at));
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.created_by, row.delivered_by]).filter((id): id is string => !!id)),
    ];
    const people = userIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [];
    const nameById = new Map(people.map((person) => [person.id, person.name]));
    return rows.map((row) => ({
      ...row,
      created_by_name: nameById.get(row.created_by) ?? null,
      delivered_by_name: row.delivered_by ? nameById.get(row.delivered_by) ?? null : null,
    }));
  });
}

/** Sidebar badges — same status rule as the lists. */
export async function getPettyCashCountsAction(): Promise<ActionResult<{ pending: number; delivered: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    const [row] = await getDb()
      .select({
        pending: sql<number>`count(*) filter (where ${pettyCashTransactions.delivered_at} is null)`.mapWith(Number),
        delivered: sql<number>`count(*) filter (where ${pettyCashTransactions.delivered_at} is not null)`.mapWith(Number),
      })
      .from(pettyCashTransactions);
    return { pending: row?.pending ?? 0, delivered: row?.delivered ?? 0 };
  });
}

/**
 * The Custodian's two statuses on a cash purchase (Custodian/admin only):
 * - Cash Status: "received" / "not_received" (cash_confirmed_at)
 * - Item Status: "delivered" / "pending" (delivered_at) — Delivered moves the
 *   row to Delivered Cash Purchase, Pending moves it back.
 * An item can only be Delivered once its Cash Status is Received. Setting
 * Cash Status to Received also fills in Date Received (today) and Name of
 * Receiver (the Custodian who set it), and is final — it can't be set back
 * to Not Received, and those two fields can't be edited afterwards.
 */
export async function setPettyCashCustodianStatusAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    assertId(id, "transaction ID");
    if (!canConfirmDelivery(user)) throw new ForbiddenError("Only a Custodian can set Cash Status and Item Status.");
    const input = asRecord(value);
    const cash = input.cash_status;
    const item = input.item_status;
    if (cash !== undefined && cash !== "received" && cash !== "not_received") throw new ValidationError("Invalid Cash Status.");
    if (item !== undefined && item !== "delivered" && item !== "pending") throw new ValidationError("Invalid Item Status.");
    if (cash === undefined && item === undefined) throw new ValidationError("Nothing to update.");

    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, id)).for("update");
      if (!row) throw new NotFoundError("Petty Cash transaction not found.");
      if (cash === "not_received" && row.cash_confirmed_at) {
        throw new ValidationError(`${row.serial}'s Cash Status is already Received and can't be changed back.`);
      }
      const cashReceived = cash === undefined ? row.cash_confirmed_at != null : cash === "received";
      const delivered = item === undefined ? row.delivered_at != null : item === "delivered";
      if (delivered && !cashReceived) {
        throw new ValidationError("Set Cash Status to Received before marking the item as Delivered.");
      }
      const now = new Date().toISOString();
      const patch: Partial<typeof pettyCashTransactions.$inferInsert> = {};
      if (cashReceived && !row.cash_confirmed_at) {
        patch.cash_confirmed_at = now;
        patch.cash_confirmed_by = user.id;
        // Filled in automatically, once — never overwritten later. Today in
        // the server's time zone, as YYYY-MM-DD.
        patch.cash_received_at = new Date().toLocaleDateString("en-CA");
        patch.receiver_name = user.name.toUpperCase();
      }
      if (delivered !== (row.delivered_at != null)) {
        patch.delivered_at = delivered ? now : null;
        patch.delivered_by = delivered ? user.id : null;
      }
      if (Object.keys(patch).length === 0) return; // already in that state
      await tx
        .update(pettyCashTransactions)
        .set({ ...patch, updated_at: now })
        .where(eq(pettyCashTransactions.id, id));
      await logPettyCash(tx, user, row, "Status updated", [
        ["Cash Status", row.cash_confirmed_at ? "Received" : "Not Received", cashReceived ? "Received" : "Not Received"],
        ["Item Status", row.delivered_at ? "Delivered" : "Pending", delivered ? "Delivered" : "Pending"],
        ["Date Received", row.cash_received_at ?? "", patch.cash_received_at ?? row.cash_received_at ?? ""],
        ["Receiver Name", row.receiver_name ?? "", patch.receiver_name ?? row.receiver_name ?? ""],
      ]);
    });
    await publishRequestChanged({ type: "petty_cash", action: "updated", id, department: null });
  });
}

export async function createPettyCashTransactionAction(value: unknown): Promise<ActionResult<{ id: number; serial: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    if (!isAPOfficer(user)) throw new ForbiddenError("Only AP Officer can add cash purchase transactions.");
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
        .where(sql`${pettyCashTransactions.serial} LIKE ${`CP-${year}-%`}`);
      const serial = nextSerial(`CP-${year}-`, serials.map((row) => row.serial));
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

/**
 * AP Officer only (admin too), and only PO Number and Total Amount — the
 * Cash Received / Date Received / Name of Receiver columns are no longer
 * editable here (the Custodian's Cash Status covers receipt of the cash).
 * `expected_updated_at` (the row's updated_at when the editor opened)
 * rejects the save if someone else changed the row in between.
 */
export async function updatePettyCashTransactionAction(id: number, value: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    requirePermission(user, ["petty_cash"]);
    assertId(id, "transaction ID");
    if (!isAPOfficer(user)) throw new ForbiddenError("Only AP Officer can edit cash purchase transactions.");
    const input = asRecord(value);
    const editable = new Set(["po_number", "total_amount", "expected_updated_at"]);
    const other = Object.keys(input).find((key) => !editable.has(key));
    if (other) throw new ValidationError("Only PO Number and Total Amount can be edited.");
    const poNumber = optionalString(input, "po_number", 100, "PO Number");
    if (poNumber !== undefined && !poNumber) throw new ValidationError("PO Number is required.");
    const totalAmount = input.total_amount === undefined ? undefined : moneyString(input.total_amount, "Total Amount");
    const expectedUpdatedAt = optionalString(input, "expected_updated_at", 40, "Expected version");

    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(pettyCashTransactions).where(eq(pettyCashTransactions.id, id)).for("update");
      if (!row) throw new NotFoundError("Petty Cash transaction not found.");
      // Delivered purchases are closed records — no further financial edits.
      if (row.delivered_at) throw new ValidationError(`${row.serial} is already delivered and can no longer be edited.`);
      if (expectedUpdatedAt && expectedUpdatedAt !== row.updated_at) {
        throw new ValidationError(`${row.serial} was changed by someone else. Reload the page and try again.`);
      }
      const patch: Partial<typeof pettyCashTransactions.$inferInsert> = {};
      if (poNumber) patch.po_number = poNumber.toUpperCase();
      if (totalAmount !== undefined) patch.total_amount = totalAmount;

      const changes: Array<[string, string, string]> = [
        ["PO Number", row.po_number, patch.po_number ?? row.po_number],
        ["Total Amount", row.total_amount, patch.total_amount ?? row.total_amount],
      ];
      // Nothing actually changed (e.g. a double-clicked Save) — leave the
      // row and its history alone.
      if (changes.every(([, before, after]) => before === after)) return;

      await tx
        .update(pettyCashTransactions)
        .set({ ...patch, updated_at: new Date().toISOString() })
        .where(eq(pettyCashTransactions.id, id));
      await logPettyCash(tx, user, row, "Edited", changes);
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
