import { useState, useEffect, useCallback, useRef } from "react";
import { itemRequestAPI, serviceRequestAPI } from "../../../services/api";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { debounce } from "@shared/utils/debounce";

// Polling stays as a fallback in case a socket event is missed (e.g. a brief
// disconnect); realtime updates via useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

/** Item + service requests awaiting this user's action — feeds the Pending
 * Requests sidebar badge. startDate/endDate ("" = all time) come from the
 * shared DateRangeContext; unlike the other sidebar counts this endpoint
 * returns only a number (no rows), so the range has to be sent to the server
 * rather than filtered here. */
export const usePendingCount = (role: string | undefined, startDate = "", endDate = "") => {
  const [count, setCount] = useState(0);

  const targetRoles = ["staff", "secretary", "supervisor", "manager", "custodian", "admin"];
  const active = role ? targetRoles.includes(role.toLowerCase()) : false;

  const fetchCount = useCallback(async () => {
    if (!active) return;
    try {
      const params = { startDate: startDate || undefined, endDate: endDate || undefined };
      const [items, services] = await Promise.all([
        itemRequestAPI.getPendingCount(params),
        serviceRequestAPI.getPendingCount(params),
      ]);
      setCount(items.data.count + services.data.count);
    } catch {
      // silently ignore — sidebar badge is non-critical
    }
  }, [active, startDate, endDate]);

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      if (!active) return;
      try {
        const params = { startDate: startDate || undefined, endDate: endDate || undefined };
        const [items, services] = await Promise.all([
          itemRequestAPI.getPendingCount(params),
          serviceRequestAPI.getPendingCount(params),
        ]);
        if (!cancelled) {
          setCount(items.data.count + services.data.count);
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
  }, [active, startDate, endDate]);

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
