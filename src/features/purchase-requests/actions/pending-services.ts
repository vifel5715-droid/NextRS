"use server";

import type { PendingService } from "@/lib/api";
import { getRequestListsAction } from "@/features/requests/actions/request-lists";

export async function getPendingServicesAction(): Promise<PendingService[]> {
  const { serviceRequests } = await getRequestListsAction();

  return serviceRequests
    .filter((request) => request.pr_status !== "finish")
    .map((request) => ({
      id: request.id,
      serial: request.serial,
      purpose: request.purpose,
      status: request.status,
      supervisor_status: request.supervisor_status ?? null,
      custodian_status: request.custodian_status ?? null,
      created_at: request.created_at,
      pr_number: request.pr_number ?? null,
      pr_status: request.pr_status ?? null,
      services: (request.services ?? []).map((service) => ({
        description: service.description,
      })),
    }));
}
