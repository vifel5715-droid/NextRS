import { useState, useEffect, useCallback, useRef } from "react";
import { getSpecialRequestCountsAction, type SpecialRequestCounts } from "@/features/requests/actions/special-requests";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { debounce } from "@/lib/utils/debounce";

/**
 * Urgent + reimbursement counts for the Dashboard's All Requests Summary,
 * within the shared date range. A count is null when the server says this
 * user can't list that request type, so the card is hidden rather than
 * showing a misleading zero. Only the Dashboard page mounts this.
 */
export const useSpecialRequestCounts = () => {
  const { startDate, endDate } = useDateRangeContext();
  const [counts, setCounts] = useState<SpecialRequestCounts>({ urgentCount: null, reimbursementCount: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchCounts = useCallback(async () => {
    try {
      const startAt = startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined;
      const endAt = endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined;
      setCounts(await getSpecialRequestCountsAction(startAt, endAt));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  const debouncedFetch = useRef(debounce(fetchCounts, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchCounts, 400);
  }, [fetchCounts]);
  const handleChange = useCallback(() => debouncedFetch.current(), []);
  useRequestsChanged(handleChange);

  return { ...counts, loading, error };
};
