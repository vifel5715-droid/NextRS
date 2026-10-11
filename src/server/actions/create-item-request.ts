"use server";

import { like, sql } from "drizzle-orm";
import { runAction, type ActionResult } from "../action-result";
import { getCurrentUser } from "../auth/session";
import { publishRequestChanged } from "../realtime";
import { getDb } from "../db";
import { itemRequestItems, itemRequests } from "../db/schema";

const MAX_ATTACHMENT_BYTES = 10.5 * 1024 * 1024;
const ITEM_TYPES = new Set(["out", "purchase", "payment", "pending"]);

interface RequestItemInput {
  item_name: string;
  quantity: number;
  uom: string;
  remarks?: string;
  machine_code?: string;
}

function requiredField(formData: FormData, key: string, maxLength: number): string {
  const value = formData.get(key);
  if (typeof value !== "string") throw new Error(`Invalid ${key}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${key}.`);
  return normalized;
}

function parseRequestItems(value: FormDataEntryValue | null): RequestItemInput[] {
  if (typeof value !== "string") throw new Error("Request items are required.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Request items are invalid.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error("A request must contain between 1 and 100 items.");
  }

  return parsed.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Request item is invalid.");
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.item_name !== "string" ||
      !item.item_name.trim() ||
      item.item_name.length > 500 ||
      typeof item.uom !== "string" ||
      !item.uom.trim() ||
      item.uom.length > 100 ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      (item.remarks !== undefined && typeof item.remarks !== "string") ||
      (item.machine_code !== undefined && typeof item.machine_code !== "string")
    ) {
      throw new Error("One or more request items have invalid fields.");
    }

    return {
      item_name: item.item_name.trim(),
      quantity: item.quantity,
      uom: item.uom.trim(),
      remarks: typeof item.remarks === "string" ? item.remarks.trim() : "",
      machine_code:
        typeof item.machine_code === "string" && item.machine_code.trim()
          ? item.machine_code.trim()
          : undefined,
    };
  });
}

export async function createItemRequestAction(formData: FormData): Promise<ActionResult<void>> {
  return runAction(() => createItemRequest(formData));
}

async function createItemRequest(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("create_request")) throw new Error("Permission denied.");

  const department = requiredField(formData, "department", 100).toUpperCase();
  const requestedByValue = formData.get("requested_by");
  if (typeof requestedByValue !== "string" || requestedByValue.length > 200) {
    throw new Error("Invalid requester name.");
  }
  const requestedBy = requestedByValue.trim() || user.name;
  const requestType = requiredField(formData, "request_type", 30).toLowerCase();
  const purpose = requiredField(formData, "purpose", 2000);
  const remarksValue = formData.get("remarks");
  if (typeof remarksValue !== "string" || remarksValue.length > 5000) {
    throw new Error("Invalid remarks.");
  }
  const remarks = remarksValue.trim();
  if (!ITEM_TYPES.has(requestType)) throw new Error("Invalid request type.");
  if (
    department !== user.department.toUpperCase() &&
    !["admin", "secretary"].includes(user.role.toLowerCase())
  ) {
    throw new Error("You can only create requests for your department.");
  }

  const items = parseRequestItems(formData.get("items"));
  const attachmentEntry = formData.get("attachment");
  let attachment: {
    data: Buffer;
    name: string;
  } | undefined;

  if (attachmentEntry !== null) {
    if (!(attachmentEntry instanceof File) || attachmentEntry.size === 0) {
      throw new Error("The PDF attachment is invalid.");
    }
    if (attachmentEntry.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("PDF attachments cannot exceed 10.5 MB.");
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

    attachment = {
      data: bytes,
      name: attachmentEntry.name.replace(/[\\/]/g, "_").slice(0, 255),
    };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const serialPrefix = `IRS-00-${year}-`;

  const createdId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`item-request-serial-${year}`}))`);

    const existingSerials = await tx
      .select({ serial: itemRequests.serial })
      .from(itemRequests)
      .where(like(itemRequests.serial, `${serialPrefix}%`));
    const nextNumber =
      existingSerials.reduce((maximum, row) => {
        const match = row.serial.match(/-(\d+)$/);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0) + 1;
    const serial = `${serialPrefix}${String(nextNumber).padStart(6, "0")}`;

    const [request] = await tx
      .insert(itemRequests)
      .values({
        serial,
        department,
        created_by: user.id,
        requested_by: requestedBy,
        purpose,
        remarks: remarks || null,
        status: "pending",
        supervisor_status: "pending",
        custodian_status: "pending",
        request_type: requestType,
        created_at: now,
        ...(attachment
          ? {
              attachment_name: attachment.name,
              attachment_data: attachment.data,
              attachment_mime: "application/pdf",
              attachment_size: attachment.data.length,
            }
          : {}),
      })
      .returning({ id: itemRequests.id });

    if (!request) throw new Error("Failed to create item request.");

    await tx.insert(itemRequestItems).values(
      items.map((item) => ({
        request_id: request.id,
        item_name: item.item_name,
        quantity: item.quantity,
        uom: item.uom,
        remarks: item.remarks || null,
        machine_code: item.machine_code ?? null,
        qty_balance: item.quantity,
      }))
    );
    return request.id;
  });

  await publishRequestChanged({ type: "item", action: "created", id: createdId, department });
}
