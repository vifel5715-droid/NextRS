"use server";

import { like, sql } from "drizzle-orm";
import type { ServiceFormData, ServiceRow } from "@shared/types";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { serviceItems, serviceRequests } from "../db/schema";

export interface CreateServiceRequestInput extends ServiceFormData {
  services: Pick<ServiceRow, "description">[];
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${field}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${field}.`);
  return normalized;
}

export async function createServiceRequestAction(input: CreateServiceRequestInput): Promise<void> {
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
  const serialPrefix = `SRS-00-${year}-`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`service-request-serial-${year}`}))`);

    const existingSerials = await tx
      .select({ serial: serviceRequests.serial })
      .from(serviceRequests)
      .where(like(serviceRequests.serial, `${serialPrefix}%`));
    const nextNumber =
      existingSerials.reduce((maximum, row) => {
        const match = row.serial.match(/-(\d+)$/);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0) + 1;
    const serial = `${serialPrefix}${String(nextNumber).padStart(6, "0")}`;

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
      .returning({ id: serviceRequests.id });

    if (!request) throw new Error("Failed to create service request.");

    await tx.insert(serviceItems).values(
      services.map((description) => ({
        service_request_id: request.id,
        description,
      }))
    );
  });
}
