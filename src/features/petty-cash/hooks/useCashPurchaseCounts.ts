import { useCallback, useEffect, useMemo, useState } from "react";
import { pettyCashAPI } from "@/lib/api";

// Petty-cash changes aren't delivered over the realtime stream (see
// realtime-client.ts), so other users' changes arrive by polling; the
// Cash Purchase pages call `refresh` right after their own changes.
const POLL_INTERVAL_MS = 30_000;

export interface CashPurchaseCounts {
  pending: number;
  delivered: number;
  refresh: () => void;
}

/** Pending / Delivered Cash Purchase sidebar badges. */
export const useCashPurchaseCounts = (enabled: boolean): CashPurchaseCounts => {
  const [counts, setCounts] = useState({ pending: 0, delivered: 0 });

  const refresh = useCallback(() => {
    if (!enabled) return;
    pettyCashAPI
      .getCounts()
      .then((res) => setCounts(res.data))
      .catch(() => {
        // silently ignore — sidebar badge is non-critical
      });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  return useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
};
