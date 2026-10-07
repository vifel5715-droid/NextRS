import { useState, useEffect, useCallback, useRef } from "react";
import { itemRequestAPI } from "../../../services/api";
import type { DeliveredItem } from "../../../services/api";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { debounce } from "@shared/utils/debounce";

export const useDeliveredItems = (enabled = true) => {
  const [items, setItems] = useState<DeliveredItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      const res = await itemRequestAPI.getDeliveredItems();
      setItems(res.data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      return;
    }

    fetchItems();
  }, [enabled, fetchItems]);

  const debouncedFetch = useRef(debounce(fetchItems, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchItems, 400);
  }, [fetchItems]);

  const handleChange = useCallback((payload: { type: "item" | "service" | "urgent" | "reimbursement" }) => {
    if (payload.type === "item") debouncedFetch.current();
  }, []);
  useRequestsChanged(handleChange);

  return { items, loading };
};
