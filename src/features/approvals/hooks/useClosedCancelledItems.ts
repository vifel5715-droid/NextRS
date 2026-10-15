import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLogger } from "@/lib/client-logger";
import { debounce } from "@/lib/utils/debounce";
import { useRequestsChanged, type RequestChangedPayload } from "@/hooks/useRequestsChanged";
import { fetchRequestLists } from "@/lib/api";
import type { ItemRequest } from "@/types";
import { toClosedCancelledRows } from "@/features/approvals/utils/closedCancelledItems";

const log = createLogger("useClosedCancelledItems");

/**
 * Every item request in the caller's scope (the same server-side role and
 * department scoping as the Item Requests tab — GET /api/requests), kept
 * whole rather than dropping Complete requests the way the Item Requests tab
 * does: a request whose items are all Closed counts as Complete, but its
 * items still belong on the Closed / Cancelled tab.
 */
export const useClosedCancelledItems = ({ enabled = true }: { enabled?: boolean } = {}) => {
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
            log.error("Failed to load closed/cancelled items:", err);
            setError("Failed to load closed and cancelled items. Please try again.");
          }
        )
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  // Any item request change can close, cancel or reopen an item — one
  // debounced full reload rather than patching rows in place.
  const debouncedLoad = useRef(debounce(() => void load(), 500)).current;
  const handleChange = useCallback(
    (payload: RequestChangedPayload) => {
      if (enabled && payload.type === "item") debouncedLoad();
    },
    [enabled, debouncedLoad]
  );
  useRequestsChanged(handleChange);

  const rows = useMemo(() => toClosedCancelledRows(requests), [requests]);
  return { rows, loading, error, reload: load };
};
