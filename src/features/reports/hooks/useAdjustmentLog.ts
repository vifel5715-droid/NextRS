import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getAdjustmentLogAction } from "@/features/reports/actions/history-reads";
import type { AdjustmentLogEntry } from "@/lib/api";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { debounce } from "@/lib/utils/debounce";

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
  const debouncedFetch = useRef(debounce(fetchEntries, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchEntries, 400);
  }, [fetchEntries]);
  const handleChange = useCallback(() => debouncedFetch.current(), []);
  useRequestsChanged(handleChange);

  // Narrowed to the shared date range (all time when unset) — both the
  // sidebar badge and the page's own table read from this same hook, so they
  // always agree.
  const entries = useMemo(
    () => filterByDateRange(rawEntries, startDate, endDate, "adjusted_at"),
    [rawEntries, startDate, endDate]
  );

  return useMemo(() => ({ entries, loading }), [entries, loading]);
};
