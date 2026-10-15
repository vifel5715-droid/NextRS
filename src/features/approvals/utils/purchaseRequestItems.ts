import type { ItemRequest } from "@/types";
import type { ItemTabRowBase } from "@/features/approvals/utils/closedCancelledItems";

/**
 * Purchase Requests tab of the Custodian Dashboard.
 *
 * A purchase request is per ITEM: the Custodian sets an item's
 * delivery_status to "PURCHASE REQUEST" (a PR Number is required — see
 * updateRequestItemAction), then tracks its pr_status (PENDING → DELIVERED
 * PARTIAL → DELIVERED). The PR stays active while delivery_status is still
 * "PURCHASE REQUEST"; once the item moves on (e.g. released OUT) only the
 * pr_type snapshot remains and the PR is finished, so it drops off this tab.
 * Service requests' request-level PR (pending/finish) stays on the Service
 * Requests tab.
 */
export const PURCHASE_REQUEST_STATUS = "PURCHASE REQUEST";

export const isActivePurchaseRequest = (deliveryStatus?: string | null): boolean =>
  (deliveryStatus ?? "").trim().toUpperCase() === PURCHASE_REQUEST_STATUS;

export interface PurchaseRequestItemRow extends ItemTabRowBase {
  /** Unique per item — `${requestId}-${itemId ?? index}`. */
  key: string;
  requestId: number;
  created_by: string;
  quantity: number;
  uom: string;
  /** "PENDING" | "DELIVERED PARTIAL" | "DELIVERED" ("" when not yet set). */
  pr_status: string;
  quantity_delivered: number;
}

/** Display label for an item's PR status — unset reads as Pending, the PR's starting state. */
export const formatPrStatus = (prStatus: string): string => {
  switch (prStatus.trim().toUpperCase()) {
    case "DELIVERED":
      return "Delivered";
    case "DELIVERED PARTIAL":
      return "Partial Delivered";
    default:
      return "Pending";
  }
};

/** Badge class per PR status, matching the existing Bootstrap status badges. */
export const prStatusBadgeClass = (prStatus: string): string => {
  switch (prStatus.trim().toUpperCase()) {
    case "DELIVERED":
      return "bg-success";
    case "DELIVERED PARTIAL":
      return "bg-info";
    default:
      return "bg-warning text-dark";
  }
};

/** One row per item whose PR is still active, newest request first. */
export function toPurchaseRequestRows(requests: ItemRequest[]): PurchaseRequestItemRow[] {
  const rows: PurchaseRequestItemRow[] = [];
  for (const request of requests) {
    (request.items ?? []).forEach((item, index) => {
      if (!isActivePurchaseRequest(item.delivery_status)) return;
      rows.push({
        key: `${request.id}-${item.id ?? `i${index}`}`,
        requestId: request.id,
        serial: request.serial ?? "",
        created_at: request.created_at ?? "",
        created_by: request.created_by ?? "",
        department: request.department ?? "",
        purpose: request.purpose ?? "",
        item_name: item.item_name ?? "",
        quantity: item.quantity,
        uom: item.uom ?? "",
        pr_number: item.pr_number ?? "",
        pr_status: item.pr_status ?? "",
        quantity_delivered: item.quantity_delivered ?? 0,
      });
    });
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
