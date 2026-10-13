import { useState, useEffect, useCallback, useRef } from "react";
import { getMyRequestListsAction } from "@/features/requests/actions/request-lists";
import { getCompositeStatus } from "@/lib/utils/status";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { debounce } from "@/lib/utils/debounce";
import { filterByDateRange } from "@/lib/utils/dateRange";
import type { ItemRequest, ServiceRequest } from "@/types";

// Polling stays as a fallback in case a socket event is missed (e.g. a brief
// disconnect); realtime updates via useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

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

/**
 * Own submitted item + service requests still in flight — feeds the My
 * Requests sidebar badge for staff/supervisor/manager/admin. Mirrors the
 * exact department + requested_by filter useStaffRequests.ts uses to build
 * the My Requests list, so the count always matches what that page shows.
 */
export const useMyRequestsProcessingCount = (
  role: string | undefined,
  name: string | undefined,
  department: string | undefined,
  startDate = "",
  endDate = ""
) => {
  const [count, setCount] = useState(0);

  const targetRoles = ["staff", "secretary", "supervisor", "manager", "admin"];
  const active = !!role && targetRoles.includes(role.toLowerCase()) && !!name;

  const countProcessing = (rows: Array<ItemRequest | ServiceRequest>) =>
    filterByDateRange(rows, startDate, endDate, "created_at").filter(isProcessing).length;

  const fetchCount = useCallback(async () => {
    if (!active) return;
    try {
      const { itemRequests, serviceRequests } = await getMyRequestListsAction();
      setCount(
        countProcessing(itemRequests) +
        countProcessing(serviceRequests)
      );
    } catch {
      // silently ignore — sidebar badge is non-critical
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, department, name, startDate, endDate]);

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      if (!active) return;
      try {
        const { itemRequests, serviceRequests } = await getMyRequestListsAction();
        if (!cancelled) {
          setCount(
            countProcessing(itemRequests) +
            countProcessing(serviceRequests)
          );
        }
      } catch {
        // silently ignore — sidebar badge is non-critical
      }
    };

    void runFetch();
    if (!active) return () => {
      cancelled = true;
    };
    const id = setInterval(() => {
      void runFetch();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, department, name, startDate, endDate]);

  const debouncedFetch = useRef(debounce(fetchCount, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchCount, 400);
  }, [fetchCount]);

  const handleChange = useCallback(() => {
    debouncedFetch.current();
  }, []);
  useRequestsChanged(handleChange);

  return count;
};
