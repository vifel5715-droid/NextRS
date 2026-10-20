import type { ItemRequest } from "@/types";
import { filterByDateRange } from "@/lib/utils/dateRange";

/**
 * Closed / On Hold tab of the Custodian Dashboard.
 *
 * Close and Hold are per-ITEM statuses (item_request_items.delivery_status
 * "CLOSE" / "HOLD", each with a required status_reason) — there is no
 * request-level closed/on-hold status, and service lines (pending/holded/
 * completed) and urgent requests (approval + delivery stages) have no
 * equivalent. So the tab lists one row per item whose CURRENT status is CLOSE
 * or HOLD, together with its parent request. An item moved on to another
 * status drops out, since its status_reason is cleared at that point too.
 */
export type ClosedCancelledStatus = "CLOSE" | "HOLD";

const CLOSED_CANCELLED: ReadonlySet<string> = new Set<ClosedCancelledStatus>(["CLOSE", "HOLD"]);

export interface ClosedCancelledItemRow {
  /** Unique per item — `${requestId}-${itemId ?? index}`. */
  key: string;
  requestId: number;
  serial: string;
  created_at: string;
  created_by: string;
  department: string;
  purpose: string;
  item_name: string;
  quantity: number;
  uom: string;
  pr_number: string;
  status: ClosedCancelledStatus;
  reason: string;
}

export const closedCancelledStatusOf = (deliveryStatus?: string | null): ClosedCancelledStatus | null => {
  const value = (deliveryStatus ?? "").trim().toUpperCase();
  return CLOSED_CANCELLED.has(value) ? (value as ClosedCancelledStatus) : null;
};

export const CLOSED_CANCELLED_LABELS: Record<ClosedCancelledStatus, string> = {
  CLOSE: "Closed",
  HOLD: "On Hold",
};

/** Flattens item requests into one row per currently Closed/On Hold item, newest request first. */
export function toClosedCancelledRows(requests: ItemRequest[]): ClosedCancelledItemRow[] {
  const rows: ClosedCancelledItemRow[] = [];
  for (const request of requests) {
    (request.items ?? []).forEach((item, index) => {
      const status = closedCancelledStatusOf(item.delivery_status);
      if (!status) return;
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
        status,
        reason: item.status_reason ?? "",
      });
    });
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface ClosedCancelledFilters {
  searchQuery: string;
  department: string;
  startDate: string;
  endDate: string;
}

/** The request + item fields every per-item tab row carries (Closed / Cancelled, Purchase Requests). */
export interface ItemTabRowBase {
  serial: string;
  created_at: string;
  department: string;
  purpose: string;
  item_name: string;
  pr_number: string;
  /** Extra tab-specific text the search box also matches (e.g. the Closed/Cancelled reason). */
  reason?: string;
}

/**
 * Same filters as the Item/Service tabs: search on serial, purpose, PR number
 * (plus the item name and reason, which only these per-item tabs show), the
 * department dropdown ("all" = no filter) and the request's created date range.
 */
export function filterItemTabRows<T extends ItemTabRowBase>(
  rows: T[],
  { searchQuery, department, startDate, endDate }: ClosedCancelledFilters
): T[] {
  const q = searchQuery.trim().toLowerCase();
  const searched = !q
    ? rows
    : rows.filter((row) =>
        [row.serial, row.created_at, row.purpose, row.pr_number, row.item_name, row.reason ?? ""].some((value) =>
          value.toLowerCase().includes(q)
        )
      );
  const inDepartment = department === "all" ? searched : searched.filter((row) => row.department === department);
  return filterByDateRange(inDepartment, startDate, endDate, "created_at");
}

export const filterClosedCancelledRows = filterItemTabRows<ClosedCancelledItemRow>;
