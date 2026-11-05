"use server";

import { inArray } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { requireRole } from "@/lib/permissions";
import { assertId } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { itemRequests, reimbursementRequests, serviceRequests, urgentRequests } from "@/db/schema";
import { publishRequestChanged } from "@/lib/realtime";
import { recordAudit } from "@/server/audit/audit-log";

export type DeletableRequestType = "item" | "service" | "urgent" | "reimbursement";

export interface RequestSelection {
  type: DeletableRequestType;
  id: number;
}

const REQUEST_TYPES: readonly DeletableRequestType[] = ["item", "service", "urgent", "reimbursement"];
const MAX_SELECTED_DELETE = 1000;

const tables = {
  item: itemRequests,
  service: serviceRequests,
  urgent: urgentRequests,
  reimbursement: reimbursementRequests,
} as const;

/** Validates the client's selection and groups it into unique ids per request type. */
export async function parseRequestSelections(input: unknown): Promise<Map<DeletableRequestType, number[]>> {
  if (!Array.isArray(input) || input.length === 0) throw new ValidationError("Select at least one request to delete.");
  if (input.length > MAX_SELECTED_DELETE) {
    throw new ValidationError(`At most ${MAX_SELECTED_DELETE} requests can be deleted at once.`);
  }
  const grouped = new Map<DeletableRequestType, Set<number>>();
  for (const entry of input) {
    const type = (entry as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !REQUEST_TYPES.includes(type as DeletableRequestType)) {
      throw new ValidationError("Invalid request type.");
    }
    const id = assertId((entry as { id?: unknown }).id, "request ID");
    const ids = grouped.get(type as DeletableRequestType) ?? new Set<number>();
    ids.add(id);
    grouped.set(type as DeletableRequestType, ids);
  }
  return new Map([...grouped].map(([type, ids]) => [type, [...ids]]));
}

/**
 * Admin-only permanent delete of the requests selected on Summary Requests,
 * of any type and at any stage. Ids are validated and re-read inside one
 * transaction (rows locked), so a request already gone is simply counted as
 * not found. Child rows (items, services, statuses, audits, payment forms,
 * attachments) go with the header via ON DELETE CASCADE. Each deleted request
 * is written to the audit trail in the same transaction.
 */
export async function deleteSelectedRequestsAction(
  selections: RequestSelection[]
): Promise<ActionResult<{ deleted: number; notFound: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    requireRole(user, ["admin"]);
    const grouped = await parseRequestSelections(selections);
    const requested = [...grouped.values()].reduce((sum, ids) => sum + ids.length, 0);

    const deleted = await getDb().transaction(async (tx) => {
      const removed: Array<{ type: DeletableRequestType; id: number; serial: string; department: string }> = [];
      for (const [type, ids] of grouped) {
        const table = tables[type];
        const found = await tx
          .select({ id: table.id, serial: table.serial, department: table.department })
          .from(table)
          .where(inArray(table.id, ids))
          .for("update");
        if (found.length === 0) continue;
        await tx.delete(table).where(inArray(table.id, found.map((row) => row.id)));
        for (const row of found) {
          removed.push({ type, id: row.id, serial: row.serial ?? "", department: row.department });
          await recordAudit(tx, {
            action: "request.deleted",
            actor: { id: user.id, name: user.name },
            entityType: `${type}_request`,
            entityId: row.id,
            department: row.department,
            details: { serial: row.serial, source: "summary_requests_bulk_delete" },
          });
        }
      }
      return removed;
    });

    await Promise.all(
      deleted.map((row) => publishRequestChanged({ type: row.type, action: "deleted", id: row.id, department: row.department }))
    );
    return { deleted: deleted.length, notFound: requested - deleted.length };
  });
}
