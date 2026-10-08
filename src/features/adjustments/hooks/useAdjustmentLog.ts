import { useState, useEffect, useCallback, useMemo } from "react";
import { getAdjustmentLogAction } from "@server/actions/history-reads";
import type { AdjustmentLogEntry } from "@services/api";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";

export const useAdjustmentLog = (enabled = true) => {
  const { startDate, endDate } = useDateRangeContext();
  const [rawEntries, setRawEntries] = useState<AdjustmentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    if (!enabled) {
      setRawEntries([]);
      setLoading(false);
      return;
    }

    try {
      setRawEntries(await getAdjustmentLogAction());
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // An adjustment is written as part of saving an item request edit, which
  // emits an "updated" event for the parent request — same refetch signal
  // useDeletionLog uses.
  useRequestsChanged(fetchEntries);

  // Narrowed to the shared date range (all time when unset) — both the
  // sidebar badge and the page's own table read from this same hook, so they
  // always agree.
  const entries = useMemo(
    () => filterByDateRange(rawEntries, startDate, endDate, "adjusted_at"),
    [rawEntries, startDate, endDate]
  );

  return { entries, loading };
};
