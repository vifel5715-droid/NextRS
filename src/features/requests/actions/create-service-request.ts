"use server";

import { and, desc, eq, gte, like } from "drizzle-orm";
import type { ServiceFormData, ServiceRow } from "@/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/lib/session";
import { publishRequestChanged } from "@/lib/realtime";
import { getDb } from "@/lib/db";
import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";
import { serviceItems, serviceRequests } from "@/db/schema";

// A repeat of the same submission inside this window is treated as an
// accidental double submit rather than a second request (same rule as
// urgent requests and petty cash).
const DUPLICATE_WINDOW_MS = 30_000;

export interface CreateServiceRequestInput extends ServiceFormData {
  services: Pick<ServiceRow, "description">[];
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${field}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${field}.`);
  return normalized;
}

/** What the requester is told after submitting: the new request's serial number. */
export interface CreatedRequest {
  id: number;
  serial: string;
}

export async function createServiceRequestAction(input: CreateServiceRequestInput): Promise<ActionResult<CreatedRequest>> {
  return runAction(() => createServiceRequest(input));
}

async function createServiceRequest(input: CreateServiceRequestInput): Promise<CreatedRequest> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("create_request")) throw new Error("Permission denied.");

  if (!input || typeof input !== "object") throw new Error("Invalid service request.");

  const department = requiredText(input.department, "department", 100).toUpperCase();
  const requestedByValue = input.requested_by;
  if (typeof requestedByValue !== "string" || requestedByValue.length > 200) {
    throw new Error("Invalid requester name.");
  }
  const requestedBy = requestedByValue.trim() || user.name;
  const purpose = requiredText(input.purpose, "purpose", 2000).toUpperCase();
  if (typeof input.remarks !== "string" || input.remarks.length > 5000) {
    throw new Error("Invalid remarks.");
  }
  const remarks = input.remarks.trim().toUpperCase();

  if (
    department !== user.department.toUpperCase() &&
    !["admin", "secretary"].includes(user.role.toLowerCase())
  ) {
    throw new Error("You can only create requests for your department.");
  }
  if (!Array.isArray(input.services) || input.services.length > 101) {
    throw new Error("Service rows are invalid.");
  }

  const services = input.services
    .map((service) => {
      if (!service || typeof service !== "object") throw new Error("Service row is invalid.");
      const description = service.description;
      if (typeof description !== "string" || description.length > 2000) {
        throw new Error("Service description is invalid.");
      }
      return description.trim().toUpperCase();
    })
    .filter(Boolean);

  if (services.length === 0 || services.length > 100) {
    throw new Error("A request must contain between 1 and 100 services.");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const serialPrefix = `SRS-${year}-`;

  const created = await db.transaction(async (tx) => {
    await lockSerialSequence(tx, `service-request-serial-${year}`);

    // The lock above serializes concurrent submits, so a double click sees
    // the first request here instead of creating a second one.
    const [recent] = await tx
      .select({ serial: serviceRequests.serial })
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.created_by, user.id),
          eq(serviceRequests.purpose, purpose),
          gte(serviceRequests.created_at, new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
        )
      )
      .orderBy(desc(serviceRequests.created_at))
      .limit(1);
    if (recent) throw new Error(`This service request was already submitted as ${recent.serial}.`);

    const existingSerials = await tx
      .select({ serial: serviceRequests.serial })
      .from(serviceRequests)
      .where(like(serviceRequests.serial, `${serialPrefix}%`));
    const serial = nextSerial(serialPrefix, existingSerials.map((row) => row.serial));

    const [request] = await tx
      .insert(serviceRequests)
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
        created_at: now,
      })
      .returning({ id: serviceRequests.id, serial: serviceRequests.serial });

    if (!request) throw new Error("Failed to create service request.");

    await tx.insert(serviceItems).values(
      services.map((description) => ({
        service_request_id: request.id,
        description,
      }))
    );
    return request;
  });

  await publishRequestChanged({ type: "service", action: "created", id: created.id, department });
  return created;
}
