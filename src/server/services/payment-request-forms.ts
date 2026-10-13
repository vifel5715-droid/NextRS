import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { ItemPaymentRequestForm, PaymentRequestForm, SubmittedPaymentRequest } from "@/types";
import { type AuthorizedUser } from "@/lib/auth";
import { hasAnyPermission, isDepartmentScoped, requireDepartmentAccess } from "@/lib/permissions";
import { asRecord, moneyString, optionalString } from "@/lib/validation";
import { getDb } from "@/lib/db";
import {
  itemPaymentRequestForms,
  itemRequestItems,
  itemRequests,
  paymentRequestForms,
  urgentRequestItems,
  urgentRequests,
  users,
} from "@/db/schema";

/**
 * ARCH: the F-ACC-003 "Payment Request" form, for both of its sources —
 * Urgent Requests (payment_request_forms) and "Urgent Item From IRS" Item
 * Requests (item_payment_request_forms). The two tables are identical apart
 * from their parent key, and so are the rules, so they share one code path:
 *
 *  - Particulars are derived at read time from the parent's items with
 *    purchasing_transaction = 'payment_request' (never duplicated).
 *  - total_amount_due is an optional manual override of the computed sum.
 *  - Once submitted the form is locked to AP Officer/Operations
 *    Manager/admin (ap_officer_dashboard); submitting twice is refused.
 */
export type FormSource = "urgent" | "item";

const HEADER_FIELDS = ["payee", "department", "date", "date_needed", "note", "prepared_by", "checked_by", "approved_by"] as const;
const HEADER_LIMITS: Record<(typeof HEADER_FIELDS)[number], number> = {
  payee: 200,
  department: 100,
  date: 20,
  date_needed: 20,
  note: 1000,
  prepared_by: 200,
  checked_by: 200,
  approved_by: 200,
};

/** Who can edit a form after it has been submitted. */
export const canEditSubmittedForm = (user: AuthorizedUser) =>
  user.roleKey === "admin" || hasAnyPermission(user, ["ap_officer_dashboard"]);

interface ParentInfo {
  department: string;
  created_at: string;
  requested_by: string | null;
  date_needed: string | null;
  /** Urgent Requests only become payable once Stockroom has cleared them. */
  payable: boolean;
}

async function loadParent(source: FormSource, requestId: number): Promise<ParentInfo> {
  const db = getDb();
  if (source === "urgent") {
    const [request] = await db.select().from(urgentRequests).where(eq(urgentRequests.id, requestId)).limit(1);
    if (!request) throw new Error("Urgent request not found.");
    return {
      department: request.department,
      created_at: request.created_at,
      requested_by: request.requested_by,
      date_needed: request.date_needed,
      payable: request.stockroom_status === "approved" || request.stockroom_status === "not_required",
    };
  }
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)).limit(1);
  if (!request) throw new Error("Item request not found.");
  return {
    department: request.department,
    created_at: request.created_at,
    requested_by: request.requested_by,
    date_needed: null,
    payable: true,
  };
}

async function loadParticulars(source: FormSource, requestId: number) {
  const db = getDb();
  if (source === "urgent") {
    const rows = await db
      .select()
      .from(urgentRequestItems)
      .where(and(eq(urgentRequestItems.request_id, requestId), eq(urgentRequestItems.purchasing_transaction, "payment_request")))
      .orderBy(urgentRequestItems.id);
    return rows.map((item) => ({
      id: item.id,
      description: item.item_description,
      quantity: item.quantity,
      uom: item.uom,
      amount: item.amount,
      date_needed: null as string | null,
    }));
  }
  const rows = await db
    .select()
    .from(itemRequestItems)
    .where(and(eq(itemRequestItems.request_id, requestId), eq(itemRequestItems.purchasing_transaction, "payment_request")))
    .orderBy(itemRequestItems.id);
  return rows.map((item) => ({
    id: item.id,
    description: item.item_name,
    quantity: item.quantity as number | null,
    uom: item.uom as string | null,
    amount: item.amount,
    date_needed: item.date_needed,
  }));
}

async function loadFormRow(source: FormSource, requestId: number) {
  const db = getDb();
  const table = source === "urgent" ? paymentRequestForms : itemPaymentRequestForms;
  const key = source === "urgent" ? paymentRequestForms.urgent_request_id : itemPaymentRequestForms.item_request_id;
  const [form] = await db.select().from(table).where(eq(key, requestId)).limit(1);
  return form;
}

export async function readPaymentRequestForm(
  source: FormSource,
  requestId: number,
  user: AuthorizedUser
): Promise<PaymentRequestForm | ItemPaymentRequestForm> {
  const parent = await loadParent(source, requestId);
  requireDepartmentAccess(user, parent.department);
  const [form, particulars] = await Promise.all([loadFormRow(source, requestId), loadParticulars(source, requestId)]);

  const computedTotal = particulars.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  // Item Requests have no request-level Date Needed — default to the earliest
  // one among the Particulars (ISO dates sort lexicographically).
  const earliestDateNeeded = particulars.map((item) => item.date_needed).filter((d): d is string => !!d).sort()[0] ?? null;
  let submittedByName: string | null = null;
  if (form?.submitted_by) {
    const [submitter] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, form.submitted_by)).limit(1);
    submittedByName = submitter?.name ?? null;
  }

  const common = {
    payee: form?.payee ?? null,
    department: form?.department ?? parent.department,
    date: form?.date ?? parent.created_at.slice(0, 10),
    date_needed: form?.date_needed ?? parent.date_needed ?? earliestDateNeeded,
    note: form?.note ?? null,
    prepared_by: form?.prepared_by ?? parent.requested_by ?? null,
    checked_by: form?.checked_by ?? null,
    approved_by: form?.approved_by ?? null,
    particulars: particulars.map(({ date_needed: _dateNeeded, ...item }) => item),
    total_amount_due: form?.total_amount_due ?? computedTotal.toFixed(2),
    submitted: form?.submitted ?? false,
    submitted_by_name: submittedByName,
    submitted_at: form?.submitted_at ?? null,
    created_at: form?.created_at ?? null,
    updated_at: form?.updated_at ?? null,
  };
  return source === "urgent"
    ? { urgent_request_id: requestId, ...common }
    : { item_request_id: requestId, ...common };
}

function parseHeaderFields(value: unknown) {
  const input = asRecord(value, "payment request form");
  const fields: Partial<Record<(typeof HEADER_FIELDS)[number], string | null>> = {};
  for (const key of HEADER_FIELDS) {
    const parsed = optionalString(input, key, HEADER_LIMITS[key]);
    if (parsed !== undefined) fields[key] = parsed || null;
  }
  let totalAmountDue: string | null | undefined;
  if ("total_amount_due" in input) {
    const raw = input.total_amount_due;
    totalAmountDue = raw === undefined || raw === null || raw === "" ? null : moneyString(raw, "Total Amount Due");
  }
  return { fields, totalAmountDue };
}

export async function savePaymentRequestForm(
  source: FormSource,
  requestId: number,
  value: unknown,
  user: AuthorizedUser
): Promise<{ department: string }> {
  const parent = await loadParent(source, requestId);
  requireDepartmentAccess(user, parent.department);
  if (!parent.payable) throw new Error("Only Stockroom-approved requests can have a Payment Request Form.");
  const { fields, totalAmountDue } = parseHeaderFields(value);
  const now = new Date().toISOString();
  const db = getDb();

  await db.transaction(async (tx) => {
    const table = source === "urgent" ? paymentRequestForms : itemPaymentRequestForms;
    const key = source === "urgent" ? paymentRequestForms.urgent_request_id : itemPaymentRequestForms.item_request_id;
    const [existing] = await tx.select().from(table).where(eq(key, requestId)).for("update");
    if (existing?.submitted && !canEditSubmittedForm(user)) {
      throw new Error("This Payment Request has already been submitted — only AP Officer can edit it now.");
    }
    const values = {
      ...fields,
      ...(totalAmountDue !== undefined ? { total_amount_due: totalAmountDue } : {}),
      updated_at: now,
    };
    if (existing) {
      await tx.update(table).set(values).where(eq(key, requestId));
    } else if (source === "urgent") {
      await tx.insert(paymentRequestForms).values({ urgent_request_id: requestId, ...values, created_by: user.id, created_at: now });
    } else {
      await tx.insert(itemPaymentRequestForms).values({ item_request_id: requestId, ...values, created_by: user.id, created_at: now });
    }
  });
  return { department: parent.department };
}

export async function submitPaymentRequestForm(
  source: FormSource,
  requestId: number,
  user: AuthorizedUser
): Promise<{ department: string }> {
  const parent = await loadParent(source, requestId);
  requireDepartmentAccess(user, parent.department);
  if (!parent.payable) throw new Error("Only Stockroom-approved requests can have a Payment Request Form.");
  const particulars = await loadParticulars(source, requestId);
  if (particulars.length === 0) {
    throw new Error("Classify at least one item as Payment Request before submitting the form.");
  }
  const now = new Date().toISOString();
  const db = getDb();

  await db.transaction(async (tx) => {
    const table = source === "urgent" ? paymentRequestForms : itemPaymentRequestForms;
    const key = source === "urgent" ? paymentRequestForms.urgent_request_id : itemPaymentRequestForms.item_request_id;
    const [existing] = await tx.select().from(table).where(eq(key, requestId)).for("update");
    if (existing?.submitted) throw new Error("This Payment Request has already been submitted.");
    const values = { submitted: true, submitted_by: user.id, submitted_at: now, updated_at: now };
    if (existing) {
      await tx.update(table).set(values).where(eq(key, requestId));
    } else if (source === "urgent") {
      await tx.insert(paymentRequestForms).values({ urgent_request_id: requestId, ...values, created_by: user.id, created_at: now });
    } else {
      await tx.insert(itemPaymentRequestForms).values({ item_request_id: requestId, ...values, created_by: user.id, created_at: now });
    }
  });
  return { department: parent.department };
}

export async function listSubmittedPaymentRequests(
  source: FormSource,
  user: AuthorizedUser
): Promise<SubmittedPaymentRequest[]> {
  const db = getDb();
  const rows =
    source === "urgent"
      ? await db
          .select({
            request_id: paymentRequestForms.urgent_request_id,
            serial: urgentRequests.serial,
            request_department: urgentRequests.department,
            department: paymentRequestForms.department,
            payee: paymentRequestForms.payee,
            total_amount_due: paymentRequestForms.total_amount_due,
            submitted_by: paymentRequestForms.submitted_by,
            submitted_at: paymentRequestForms.submitted_at,
            created_at: paymentRequestForms.created_at,
          })
          .from(paymentRequestForms)
          .innerJoin(urgentRequests, eq(urgentRequests.id, paymentRequestForms.urgent_request_id))
          .where(eq(paymentRequestForms.submitted, true))
          .orderBy(desc(paymentRequestForms.submitted_at))
      : await db
          .select({
            request_id: itemPaymentRequestForms.item_request_id,
            serial: itemRequests.serial,
            request_department: itemRequests.department,
            department: itemPaymentRequestForms.department,
            payee: itemPaymentRequestForms.payee,
            total_amount_due: itemPaymentRequestForms.total_amount_due,
            submitted_by: itemPaymentRequestForms.submitted_by,
            submitted_at: itemPaymentRequestForms.submitted_at,
            created_at: itemPaymentRequestForms.created_at,
          })
          .from(itemPaymentRequestForms)
          .innerJoin(itemRequests, eq(itemRequests.id, itemPaymentRequestForms.item_request_id))
          .where(eq(itemPaymentRequestForms.submitted, true))
          .orderBy(desc(itemPaymentRequestForms.submitted_at));

  const visible = isDepartmentScoped(user)
    ? rows.filter((row) => row.request_department.trim().toUpperCase() === user.department.trim().toUpperCase())
    : rows;
  if (visible.length === 0) return [];

  // A form submitted without a manual override reports the computed total.
  const missingTotals = visible.filter((row) => row.total_amount_due === null).map((row) => row.request_id);
  const computedTotals = new Map<number, number>();
  if (missingTotals.length > 0) {
    const items =
      source === "urgent"
        ? await db
            .select({ request_id: urgentRequestItems.request_id, amount: urgentRequestItems.amount })
            .from(urgentRequestItems)
            .where(and(inArray(urgentRequestItems.request_id, missingTotals), eq(urgentRequestItems.purchasing_transaction, "payment_request")))
        : await db
            .select({ request_id: itemRequestItems.request_id, amount: itemRequestItems.amount })
            .from(itemRequestItems)
            .where(and(inArray(itemRequestItems.request_id, missingTotals), eq(itemRequestItems.purchasing_transaction, "payment_request")));
    for (const item of items) {
      computedTotals.set(item.request_id, (computedTotals.get(item.request_id) ?? 0) + Number(item.amount ?? 0));
    }
  }

  const submitterIds = [...new Set(visible.map((row) => row.submitted_by).filter((id): id is string => !!id))];
  const submitters = submitterIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, submitterIds))
    : [];
  const nameById = new Map(submitters.map((submitter) => [submitter.id, submitter.name]));

  return visible.map((row) => ({
    source,
    request_id: row.request_id,
    serial: row.serial,
    department: row.department ?? row.request_department,
    payee: row.payee,
    total_amount_due: row.total_amount_due ?? (computedTotals.get(row.request_id) ?? 0).toFixed(2),
    submitted_by_name: row.submitted_by ? nameById.get(row.submitted_by) ?? null : null,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
  }));
}
