import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getItemCatalogCountAction } from "@/features/dashboard/actions/dashboard-read";
import { getDashboardRequestCountsAction } from "@/features/requests/actions/request-lists";
import { getDeletionLogAction } from "@/features/reports/actions/history-reads";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { debounce } from "@/lib/utils/debounce";

/**
 * Counts for the sidebar sections that don't already have their own
 * context/hook (Complete Requests, Held Items, Item List, Deleted) — feeds
 * the Main Dashboard's summary tiles. Mirrors the same terminal-state
 * filters used by useCompleteRequestsManagement / HeldItemsPage / DeletedItemsPage
 * / ItemListPage so the counts here always agree with what those pages show.
 */
/**
 * @param canSeeDeleted - Gates only the deletion-log sub-fetch (the "Deleted"
 * badge count) — item/service requests and the catalog count are fetched
 * regardless, since every role that reaches this hook already has access to
 * those. Defaults to true so existing callers are unaffected.
 */
export const useDashboardSummary = (canSeeDeleted = true) => {
  const { startDate, endDate } = useDateRangeContext();
  const [completeRequestsCount, setCompleteRequestsCount] = useState(0);
  const [heldItemsCount, setHeldItemsCount] = useState(0);
  const [itemListCount, setItemListCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  // Fully approved, unfinished item + service requests — what the
  // Custodian/Admin "Pending Requests" dashboard (CustodianDashboard.tsx)
  // lists once a request has left Approval Requests.
  const [totalRequestsCount, setTotalRequestsCount] = useState(0);
  const [awaitingSupervisorApprovalCount, setAwaitingSupervisorApprovalCount] = useState(0);
  const [awaitingCustodianApprovalCount, setAwaitingCustodianApprovalCount] = useState(0);
  const [allRequestsCount, setAllRequestsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    try {
      const startAt = startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined;
      const endAt = endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined;
      const [requestCounts, deletedEntries, catalogCount] = await Promise.all([
        getDashboardRequestCountsAction(startAt, endAt),
        canSeeDeleted ? getDeletionLogAction() : Promise.resolve([]),
        getItemCatalogCountAction(startAt, endAt),
      ]);
      setCompleteRequestsCount(requestCounts.completeRequestsCount);
      setHeldItemsCount(requestCounts.heldItemsCount);
      setDeletedCount(filterByDateRange(deletedEntries, startDate, endDate, "deleted_at").length);
      setItemListCount(catalogCount);
      setTotalRequestsCount(requestCounts.totalRequestsCount);
      setAwaitingSupervisorApprovalCount(requestCounts.awaitingSupervisorApprovalCount);
      setAwaitingCustodianApprovalCount(requestCounts.awaitingCustodianApprovalCount);
      setAllRequestsCount(requestCounts.allRequestsCount);
    } catch {
      // silently ignore — dashboard summary is non-critical
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, canSeeDeleted]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // Debounced like the other badge hooks: a burst of events (bulk edits, or
  // the four-type resync after a reconnect) costs one refetch, not one per
  // event — and each refetch here is three server actions.
  const debouncedFetch = useRef(debounce(fetchSummary, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchSummary, 400);
  }, [fetchSummary]);
  const handleChange = useCallback(() => debouncedFetch.current(), []);
  useRequestsChanged(handleChange);

  return useMemo(
    () => ({
      completeRequestsCount,
      heldItemsCount,
      itemListCount,
      deletedCount,
      totalRequestsCount,
      awaitingSupervisorApprovalCount,
      awaitingCustodianApprovalCount,
      allRequestsCount,
      loading,
    }),
    [
      completeRequestsCount,
      heldItemsCount,
      itemListCount,
      deletedCount,
      totalRequestsCount,
      awaitingSupervisorApprovalCount,
      awaitingCustodianApprovalCount,
      allRequestsCount,
      loading,
    ]
  );
};
