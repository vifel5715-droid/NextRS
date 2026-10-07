import { useState, useEffect, useCallback } from "react";
import { itemRequestAPI, serviceRequestAPI, deletionLogAPI, itemCatalogAPI } from "../../../services/api";
import type { ItemRequest, ServiceRequest } from "@shared/types";
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
      const [itemRes, serviceRes, deletedRes, catalogCountRes] = await Promise.all([
        itemRequestAPI.getAll({}),
        serviceRequestAPI.getAll({}),
        canSeeDeleted ? deletionLogAPI.getAll() : Promise.resolve({ data: [] as Awaited<ReturnType<typeof deletionLogAPI.getAll>>["data"] }),
        // Count-only endpoint — the catalog itself can run well past a
        // megabyte, and the sidebar badge only ever needs its length.
        itemCatalogAPI.getCount({ startDate: startDate || undefined, endDate: endDate || undefined }),
      ]);
      const itemRequests = filterByDateRange(itemRes.data as ItemRequest[], startDate, endDate, "created_at");
      const serviceRequests = filterByDateRange(serviceRes.data as ServiceRequest[], startDate, endDate, "created_at");
      const deletedEntries = filterByDateRange(deletedRes.data, startDate, endDate, "deleted_at");

      setCompleteRequestsCount(
        itemRequests.filter((r) => r.all_items_served).length +
        serviceRequests.filter((r) => r.pr_status === "finish").length
      );
      setHeldItemsCount(itemRequests.filter((r) => !r.all_items_served && r.has_held_item).length);
      setDeletedCount(deletedEntries.length);
      setItemListCount(catalogCountRes.data.count);
      // Same exclusions useRequestManagement.ts's loadItemRequests/
      // loadServiceRequests apply — a fully-served item or a finished-PR
      // service moves to the Complete Requests page instead, so counting
      // them here too double-counted them into this total.
      setTotalRequestsCount(
        itemRequests.filter((r) => !r.all_items_served).length +
        serviceRequests.filter((r) => r.pr_status !== "finish").length
      );
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
