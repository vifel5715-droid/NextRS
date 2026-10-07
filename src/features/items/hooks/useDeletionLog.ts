import { useState, useEffect, useCallback } from "react";
import { deletionLogAPI } from "../../../services/api";
import type { DeletionLogEntry } from "../../../services/api";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { getErrorMessage } from "@shared/utils/errorMessage";

export const useDeletionLog = () => {
  const [entries, setEntries] = useState<DeletionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await deletionLogAPI.getAll();
      setEntries(res.data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // A delete (and a recover) emits an "updated" event for the parent request
  // (see deleteRequestItem/deleteServiceItem/recoverDeletionLogEntry) — that's
  // the closest signal this list has to "something changed", so just refetch
  // on any request change.
  useRequestsChanged(fetchEntries);

  const recover = async (id: number) => {
    try {
      await deletionLogAPI.recover(id);
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, recovered_at: new Date().toISOString() } : e));
      alert("Item recovered successfully!");
    } catch (error: unknown) {
      alert("Failed to recover item: " + getErrorMessage(error, "Failed to recover item"));
    }
  };

  return { entries, loading, recover };
};
