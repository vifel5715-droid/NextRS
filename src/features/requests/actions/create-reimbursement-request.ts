"use server";

import { and, desc, eq, gte, like } from "drizzle-orm";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { publishRequestChanged } from "@/lib/realtime";
import { getDb } from "@/lib/db";
import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";
import { reimbursementItems, reimbursementRequests } from "@/db/schema";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// A repeat of the same submission inside this window is treated as an
// accidental double submit rather than a second request (same rule as
// item, service and urgent requests).
const DUPLICATE_WINDOW_MS = 30_000;

interface ReimbursementItemInput {
  item_description: string;
  quantity?: number;
  uom?: string;
  amount: number;
}

function requiredField(formData: FormData, key: string, maxLength: number): string {
  const value = formData.get(key);
  if (typeof value !== "string") throw new Error(`Invalid ${key}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${key}.`);
  return normalized;
}

function optionalField(formData: FormData, key: string, maxLength: number): string | undefined {
  const value = formData.get(key);
  if (value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Invalid ${key}.`);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function parseItems(value: FormDataEntryValue | null): ReimbursementItemInput[] {
  if (typeof value !== "string") throw new Error("Reimbursement items are required.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Reimbursement items are invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error("A request must contain between 1 and 100 items.");
  }

  return parsed.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("A reimbursement item is invalid.");
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.item_description !== "string" ||
      !item.item_description.trim() ||
      item.item_description.length > 2000 ||
      (item.quantity !== undefined &&
        (typeof item.quantity !== "number" ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1)) ||
      (item.uom !== undefined && typeof item.uom !== "string") ||
      typeof item.amount !== "number" ||
      !Number.isFinite(item.amount) ||
      item.amount <= 0 ||
      item.amount > 9_999_999_999.99
    ) {
      throw new Error("One or more reimbursement items have invalid fields.");
    }

    const uom = typeof item.uom === "string" ? item.uom.trim() : "";
    if (uom.length > 100) throw new Error("A reimbursement item's UoM is too long.");

    return {
      item_description: item.item_description.trim(),
      quantity: typeof item.quantity === "number" ? item.quantity : undefined,
      uom: uom || undefined,
      amount: Math.round(item.amount * 100) / 100,
    };
  });
}

export async function createReimbursementRequestAction(formData: FormData): Promise<ActionResult<void>> {
  return runAction(() => createReimbursementRequest(formData));
}

async function createReimbursementRequest(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("create_request")) throw new Error("Permission denied.");

  const department = requiredField(formData, "department", 100).toUpperCase();
  const requestedBy = optionalField(formData, "requested_by", 200) ?? user.name;
  const purpose = requiredField(formData, "purpose", 2000);
  const remarks = optionalField(formData, "remarks", 5000);
  const dateNeeded = optionalField(formData, "date_needed", 10);
  const supplier = requiredField(formData, "supplier", 200);
  const items = parseItems(formData.get("items"));

  if (
    department !== user.department.toUpperCase() &&
    !["admin", "secretary"].includes(user.role.toLowerCase())
  ) {
    throw new Error("You can only create requests for your department.");
  }

  // Every reimbursement must be backed by a supporting PDF (receipt/invoice).
  const attachmentEntry = formData.get("attachment");
  if (attachmentEntry === null) {
    throw new Error("A supporting document (PDF) is required.");
  }
  if (!(attachmentEntry instanceof File) || attachmentEntry.size === 0) {
    throw new Error("The PDF attachment is invalid.");
  }
  if (attachmentEntry.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("PDF attachments cannot exceed 10 MB.");
  }
  if (
    attachmentEntry.type !== "application/pdf" ||
    !attachmentEntry.name.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Only PDF attachments are allowed.");
  }

  const bytes = Buffer.from(await attachmentEntry.arrayBuffer());
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The attachment is not a valid PDF file.");
  }
  const attachment = {
    data: bytes,
    name: attachmentEntry.name.replace(/[\\/]/g, "_").slice(0, 255),
  };

  const db = getDb();
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const serialPrefix = `RMB-${year}-`;
  const serialLockKey = `reimbursement-request-serial-${year}`;

  const createdId = await db.transaction(async (tx) => {
    await lockSerialSequence(tx, serialLockKey);

    // The lock above serializes concurrent submits, so a double click sees
    // the first request here instead of creating a second one.
    const [recent] = await tx
      .select({ serial: reimbursementRequests.serial })
      .from(reimbursementRequests)
      .where(
        and(
          eq(reimbursementRequests.created_by, user.id),
          eq(reimbursementRequests.purpose, purpose),
          eq(reimbursementRequests.supplier, supplier),
          gte(reimbursementRequests.created_at, new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
        )
      )
      .orderBy(desc(reimbursementRequests.created_at))
      .limit(1);
    if (recent) throw new Error(`This reimbursement request was already submitted as ${recent.serial}.`);

    const existingSerials = await tx
      .select({ serial: reimbursementRequests.serial })
      .from(reimbursementRequests)
      .where(like(reimbursementRequests.serial, `${serialPrefix}%`));
    const serial = nextSerial(serialPrefix, existingSerials.map((row) => row.serial));

    const [request] = await tx
      .insert(reimbursementRequests)
      .values({
        serial,
        department,
        created_by: user.id,
        requested_by: requestedBy,
        purpose,
        remarks: remarks ?? null,
        date_needed: dateNeeded ?? null,
        supplier,
        supervisor_status: "pending",
        purchaser_status: "pending",
        ap_status: "pending",
        created_at: now,
        attachment_name: attachment.name,
        attachment_data: attachment.data,
        attachment_size: attachment.data.length,
      })
      .returning({ id: reimbursementRequests.id });

    if (!request) throw new Error("Failed to create reimbursement request.");

    await tx.insert(reimbursementItems).values(
      items.map((item) => ({
        request_id: request.id,
        item_description: item.item_description,
        quantity: item.quantity ?? null,
        uom: item.uom ?? null,
        amount: item.amount.toFixed(2),
        created_at: now,
      }))
    );
    return request.id;
  });

  await publishRequestChanged({ type: "reimbursement", action: "created", id: createdId, department });
}
