import { useState, useEffect, useCallback, useRef } from "react";
import type { PendingItem } from "../../../services/api";
import { getPendingItemsAction } from "@server/actions/pending-items";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { debounce } from "@shared/utils/debounce";

// Polling stays as a fallback in case a socket event is missed (e.g. a brief
// disconnect); realtime updates via useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

export const usePendingItems = (role: string | undefined, isAuthenticated = true) => {
  const [items, setItems] = useState<PendingItem[]>([]);

  const targetRoles = ["staff", "secretary", "supervisor", "manager", "custodian"];
  const active = isAuthenticated && role ? targetRoles.includes(role.toLowerCase()) : false;

  const fetchItems = useCallback(async () => {
    if (!active) return;
    try {
      setItems(await getPendingItemsAction());
    } catch {
      // silently ignore — sidebar badge is non-critical
    }
  }, [active]);

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      if (!active) return;
      try {
        const pendingItems = await getPendingItemsAction();
        if (!cancelled) {
          setItems(pendingItems);
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
  }, [active]);

  const debouncedFetch = useRef(debounce(fetchItems, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchItems, 400);
  }, [fetchItems]);

  const handleChange = useCallback((payload: { type: "item" | "service" | "urgent" | "reimbursement" }) => {
    if (payload.type === "item") debouncedFetch.current();
  }, []);
  useRequestsChanged(handleChange);

  return items;
};
