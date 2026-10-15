import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchRequestLists } from "@/lib/api";
import { getCompositeStatus } from "@/lib/utils/status";
import { useRequestsChanged, type RequestChangedPayload } from "@/hooks/useRequestsChanged";
import { debounce } from "@/lib/utils/debounce";
import { filterByDateRange } from "@/lib/utils/dateRange";
import type { ItemRequest, ServiceRequest } from "@/types";

// Fallback only — realtime events patch the count as they happen, and the
// stream resyncs (a data-less event → full reload) after any reconnect. Each
// poll downloads the department's whole list, so it stays infrequent.
const POLL_INTERVAL_MS = 120_000;

/**
 * Still moving through the approval/fulfillment chain. "Approved (Custodian)"
 * is NOT the finish line — items keep going through delivery/release after
 * that, and services keep going through their PR — so the only true terminal
 * states are the same ones that gate the Complete Requests page: an item
 * request with all_items_served, or a service request with pr_status
 * "finish" (shown there as "SERVICE FINISHED"). Rejected is terminal too.
 */
const isProcessing = (row: ItemRequest | ServiceRequest) => {
  const composite = getCompositeStatus({ ...row });
  if (composite.class === "rejected") return false;
  if (row.all_items_served) return false;
  if ("pr_status" in row && row.pr_status === "finish") return false;
  return true;
};

type Row = ItemRequest | ServiceRequest;
const keyOf = (type: "item" | "service", id: number) => `${type}:${id}`;
const sameDepartment = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Own department's item + service requests still in flight — feeds the My
 * Requests sidebar badge for staff/supervisor/manager/admin. Same department
 * scope as the "own" list (GET /api/requests?scope=own), so the count matches
 * what the My Requests page shows.
 */
export const useMyRequestsProcessingCount = (
  role: string | undefined,
  name: string | undefined,
  department: string | undefined,
  startDate = "",
  endDate = ""
) => {
  const [rows, setRows] = useState<Map<string, Row>>(new Map());

  const targetRoles = ["staff", "secretary", "supervisor", "manager", "admin"];
  const active = !!role && targetRoles.includes(role.toLowerCase()) && !!name;

  const fetchRows = useCallback(
    (): Promise<void> =>
      !active
        ? Promise.resolve()
        : fetchRequestLists("own").then(
            ({ itemRequests, serviceRequests }) => {
              const next = new Map<string, Row>();
              itemRequests.forEach((row) => next.set(keyOf("item", row.id), row));
              serviceRequests.forEach((row) => next.set(keyOf("service", row.id), row));
              setRows(next);
            },
            () => {
              // silently ignore — sidebar badge is non-critical
            }
          ),
    [active]
  );

  useEffect(() => {
    if (!active) return;
    void fetchRows();
    const id = setInterval(() => void fetchRows(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, fetchRows, department, name]);

  const debouncedFetch = useRef(debounce(() => void fetchRows(), 400));
  useEffect(() => {
    debouncedFetch.current = debounce(() => void fetchRows(), 400);
  }, [fetchRows]);

  // Patch the one changed request when the event carries it. A row from
  // another department (an admin receives every department's events, while
  // this badge is department-scoped) is dropped rather than counted.
  const handleChange = useCallback((payload: RequestChangedPayload) => {
    if (payload.type !== "item" && payload.type !== "service") return;
    const key = keyOf(payload.type, payload.id);
    if (payload.action === "deleted") {
      setRows((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } else if (payload.data) {
      const row = payload.data as Row;
      setRows((prev) => {
        const next = new Map(prev);
        if (sameDepartment(row.department, department)) next.set(key, row);
        else next.delete(key);
        return next;
      });
    } else {
      debouncedFetch.current();
    }
  }, [department]);
  useRequestsChanged(handleChange);

  return useMemo(() => {
    if (!active) return 0;
    const all = [...rows.values()];
    return filterByDateRange(all, startDate, endDate, "created_at").filter(isProcessing).length;
  }, [active, rows, startDate, endDate]);
};
