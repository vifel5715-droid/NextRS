import { useCallback, useEffect, useState } from "react";
import { itemRequestAPI } from "../../../services/api";

/** Total attachment storage used across every request — see lib/attachmentStorage.ts server-side. */
export const useAttachmentStorageUsage = () => {
  const [usage, setUsage] = useState<{ used: number; max: number } | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await itemRequestAPI.getStorageUsage();
      setUsage(res.data);
    } catch {
      // Non-critical — the upload itself still enforces the cap server-side.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await itemRequestAPI.getStorageUsage();
        if (!cancelled) setUsage(res.data);
      } catch {
        // Non-critical — the upload itself still enforces the cap server-side.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { usage, refetch };
};
