import { useEffect } from "react";
import type { RequestChangedPayload } from "../../services/socket";

export type { RequestChangedPayload };

/** Subscribes to request-change events when a realtime publisher is available. */
export const useRequestsChanged = (onChange: (payload: RequestChangedPayload) => void) => {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    import("../../services/socket").then(({ subscribeRequestChanged }) => {
      if (cancelled) return;
      unsubscribe = subscribeRequestChanged(onChange);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [onChange]);
};
