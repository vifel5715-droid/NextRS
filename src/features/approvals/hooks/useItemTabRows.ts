import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLogger } from "@/lib/client-logger";
import { debounce } from "@/lib/utils/debounce";
import { useRequestsChanged, type RequestChangedPayload } from "@/hooks/useRequestsChanged";
import { fetchRequestLists } from "@/lib/api";
import type { ItemRequest } from "@/types";
import { toClosedCancelledRows } from "@/features/approvals/utils/closedCancelledItems";
import { toPurchaseRequestRows } from "@/features/approvals/utils/purchaseRequestItems";

const log = createLogger("useItemTabRows");

/**
 * Rows for the Custodian Dashboard's per-item tabs (Closed / Cancelled and
 * Purchase Requests), from one load of every item request in the caller's
 * scope (the same server-side role and department scoping as the Item
 * Requests tab — GET /api/requests). Kept whole rather than dropping Complete
 * requests the way the Item Requests tab does: a request whose items are all
 * Closed counts as Complete, but its items still belong on Closed / Cancelled.
 */
export const useItemTabRows = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const [requests, setRequests] = useState<ItemRequest[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      fetchRequestLists("all")
        .then(
          (res) => {
            setRequests(res.itemRequests);
            setError("");
          },
          (err: unknown) => {
            log.error("Failed to load item requests:", err);
            setError("Failed to load items. Please try again.");
          }
        )
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  // Any item request change can close, cancel, raise or finish a PR on an
  // item. The changed request arrives with the event (realtime-client), so
  // only that one is replaced; a data-less event (missed events after a
  // reconnect, or a failed lookup) falls back to one debounced full reload.
  const debouncedLoad = useRef(debounce(() => void load(), 500)).current;
  const handleChange = useCallback(
    (payload: RequestChangedPayload) => {
      if (!enabled || payload.type !== "item") return;
      if (payload.action === "deleted") {
        setRequests((prev) => prev.filter((request) => request.id !== payload.id));
      } else if (payload.data) {
        const row = payload.data;
        setRequests((prev) =>
          prev.some((request) => request.id === row.id)
            ? prev.map((request) => (request.id === row.id ? row : request))
            : [row, ...prev]
        );
      } else {
        debouncedLoad();
      }
    },
    [enabled, debouncedLoad]
  );
  useRequestsChanged(handleChange);

  const closedCancelledRows = useMemo(() => toClosedCancelledRows(requests), [requests]);
  const purchaseRequestRows = useMemo(() => toPurchaseRequestRows(requests), [requests]);
  return { closedCancelledRows, purchaseRequestRows, loading, error, reload: load };
};
