import { useState, useEffect, useCallback, useRef } from "react";
import { itemRequestAPI } from "../../../services/api";
import type { PurchasePaymentItem } from "../../../services/api";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { debounce } from "@shared/utils/debounce";

// Polling stays as a fallback in case a socket event is missed (e.g. a brief
// disconnect); realtime updates via useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

/**
 * Every item ever routed through a Purchase/Payment Request, active or
 * inactive (already delivered/released OUT) — the PendingItemsPage's
 * "Pending Purchase Items" tab uses this instead of usePendingItems so
 * already-resolved items don't just disappear from the list. See
 * item-request.controller.ts's getPurchasePaymentItems for what
 * distinguishes it from the plain "still pending" endpoint.
 */
export const usePurchasePaymentItems = (isAuthenticated = true) => {
  const [items, setItems] = useState<PurchasePaymentItem[]>([]);

  const fetchItems = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await itemRequestAPI.getPurchasePaymentItems();
      setItems(res.data);
    } catch (error) {
      console.error("Failed to load purchase/urgent items:", error);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      if (!isAuthenticated) return;
      try {
        const res = await itemRequestAPI.getPurchasePaymentItems();
        if (!cancelled) {
          setItems(res.data);
        }
      } catch (error) {
        console.error("Failed to load purchase/urgent items:", error);
      }
    };

    void runFetch();
    if (!isAuthenticated) return () => {
      cancelled = true;
    };
    const id = setInterval(() => {
      void runFetch();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAuthenticated]);

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
