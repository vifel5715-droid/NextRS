import { useState, useEffect, useCallback, useRef } from "react";
import { getStaffRequestsAction } from "@/features/requests/actions/staff-requests";
import { getReimbursementRequestsAction, getUrgentRequestsAction } from "@/features/requests/actions/special-requests";
import { isFullyApproved } from "@/lib/utils/status";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { debounce } from "@/lib/utils/debounce";
import { filterByDateRange } from "@/lib/utils/dateRange";

// Polling stays as a fallback in case a socket event is missed (e.g. a brief
// disconnect); realtime updates via useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

/**
 * Total behind the sidebar's "Pending Requests" badge — the same records the
 * Pending Requests page (StaffDashboard pendingView) lists under "All
 * Pending Requests": item + service requests the Custodian has fully
 * approved (getStaffRequestsAction already drops completed ones), within the
 * shared date range, plus every urgent and reimbursement request the user
 * can see (those tabs aren't date-filtered). Same server actions as the
 * page, so the scoping and permission checks are identical.
 */
export const useMyPendingRequestsCount = (enabled: boolean, startDate = "", endDate = "") => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!enabled) return;
    try {
      const [{ itemRequests, serviceRequests }, urgent, reimbursement] = await Promise.all([
        getStaffRequestsAction(),
        getUrgentRequestsAction(),
        getReimbursementRequestsAction(),
      ]);
      const approved = (rows: Parameters<typeof isFullyApproved>[0][]) =>
        rows.filter(isFullyApproved).length;
      setCount(
        approved(filterByDateRange(itemRequests, startDate, endDate, "created_at")) +
        approved(filterByDateRange(serviceRequests, startDate, endDate, "created_at")) +
        urgent.length +
        reimbursement.length
      );
    } catch {
      // silently ignore — sidebar badge is non-critical
    }
  }, [enabled, startDate, endDate]);

  useEffect(() => {
    if (!enabled) return;
    void fetchCount();
    const id = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, fetchCount]);

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
