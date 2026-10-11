import { useEffect, useRef } from "react";
import type { ChangeSnapshot, RequestChangedPayload } from "../../services/socket";

export type { RequestChangedPayload };

type SocketModule = typeof import("../../services/socket");
let socketModule: SocketModule | null = null;
const loadSocket = (): Promise<SocketModule> =>
  socketModule
    ? Promise.resolve(socketModule)
    : import("../../services/socket").then((mod) => (socketModule = mod));

/**
 * Subscribes to request-change events over the one shared realtime stream.
 *
 * The subscription is torn down whenever the effect cleans up — including
 * while the app shell keeps a screen mounted but hidden. When it comes back,
 * the callback receives a data-less "updated" (id 0) for each request type
 * that changed in the meantime, so a hidden screen catches up with a single
 * list refetch rather than missing events or refetching unconditionally.
 */
export const useRequestsChanged = (onChange: (payload: RequestChangedPayload) => void) => {
  const pausedAt = useRef<ChangeSnapshot | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void loadSocket().then(({ subscribeRequestChanged, replayChangesSince }) => {
      if (cancelled) return;
      unsubscribe = subscribeRequestChanged(onChange);
      if (pausedAt.current) replayChangesSince(pausedAt.current, onChange);
      pausedAt.current = null;
    });
    return () => {
      cancelled = true;
      if (unsubscribe && socketModule) pausedAt.current = socketModule.getChangeSnapshot();
      unsubscribe?.();
    };
  }, [onChange]);
};
