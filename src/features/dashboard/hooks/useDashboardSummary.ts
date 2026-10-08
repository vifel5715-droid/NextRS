import { useState, useEffect, useCallback } from "react";
import { getItemCatalogCountAction } from "@server/actions/dashboard-read";
import { getDashboardRequestCountsAction } from "@server/actions/request-lists";
import { getDeletionLogAction } from "@server/actions/history-reads";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";

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
  // Every item + service request, any status — the same total the
  // Custodian/Admin "Pending Requests" dashboard (CustodianDashboard.tsx)
  // shows across its two tabs, so the sidebar badge for that same page can
  // never disagree with what's actually on it.
  const [totalRequestsCount, setTotalRequestsCount] = useState(0);
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
    } catch {
      // silently ignore — dashboard summary is non-critical
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, canSeeDeleted]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useRequestsChanged(fetchSummary);

  return { completeRequestsCount, heldItemsCount, itemListCount, deletedCount, totalRequestsCount, loading };
};
