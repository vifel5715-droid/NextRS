import { useEffect } from "react";
import type { RequestChangedPayload } from "../../services/socket";

export type { RequestChangedPayload };

/**
 * Subscribes to realtime item/service request changes and invokes
 * `onChange` whenever one is created, updated, or deleted. Dashboards use
 * this purely as a "go refetch" signal — the payload isn't treated as a
 * source of truth, since the REST fetch it triggers already carries the
 * role/department filtering the socket event can't see.
 *
 * `services/socket` is loaded dynamically (see useSocketConnection.ts's ARCH
 * note) so the providers that use this hook — mounted for every route,
 * including the public /login page — don't pull socket.io-client into the
 * eager bundle for a visitor who was never even signed in.
 */
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
