import "server-only";

import { getDb } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { logger, redact } from "@/lib/logger";

/**
 * Append-only audit trail (audit_logs). Pass the transaction (`tx`) when the
 * event is part of a business change, so the entry commits or rolls back
 * with it. `details` is run through the logger's redaction, so a stray
 * password/token key can never be persisted.
 */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.login_throttled"
  | "auth.logout"
  | "request.supervisor_review"
  | "request.custodian_review"
  | "user.created"
  | "user.updated"
  | "user.password_changed"
  | "role.created"
  | "role.updated"
  | "role.deleted";

export interface AuditEntry {
  action: AuditAction;
  actor?: { id: string; name: string } | null;
  entityType?: string;
  entityId?: string | number;
  department?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

type Executor = Pick<ReturnType<typeof getDb>, "insert">;

export async function recordAudit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    action: entry.action,
    actor_id: entry.actor?.id ?? null,
    actor_name: entry.actor?.name ?? null,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId === undefined ? null : String(entry.entityId),
    department: entry.department ?? null,
    details: entry.details ? (redact(entry.details) as Record<string, unknown>) : null,
    ip_address: entry.ip ?? null,
  });
}

/**
 * For events with no surrounding transaction (sign-in/out): a failed audit
 * write is logged, never allowed to fail the user's action.
 */
export async function recordAuditSafely(entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(getDb(), entry);
  } catch (error) {
    logger.error("Failed to write audit log entry", { action: entry.action, error });
  }
}
