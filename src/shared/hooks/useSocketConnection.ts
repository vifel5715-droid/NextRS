import { useEffect } from "react";
import { useAuth } from "@app/providers/AuthProvider";

/**
 * Opens the realtime connection once a user is logged in, closes it on logout.
 * Mount once near the app root.
 *
 * No token is passed any more — the socket handshake authenticates with the
 * same httpOnly cookie the REST calls use (see server lib/socket.ts), so this
 * only needs to know *whether* we are signed in.
 *
 * `services/socket` (and the socket.io-client bytes it pulls in) is loaded
 * dynamically rather than statically imported, so an anonymous visit (the
 * public /login page, never authenticated) never fetches/parses it at all —
 * see vite.config.ts's manualChunks carve-out for the matching build-side
 * half of this. On first mount while logged out there is nothing to
 * disconnect, so the effect skips the import entirely; a later logout while
 * the SPA stays mounted still disconnects correctly since the module is
 * already cached from the earlier connect.
 */
export const useSocketConnection = () => {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    import("../../services/socket").then(({ connectSocket }) => {
      if (!cancelled) connectSocket();
    });
    return () => {
      cancelled = true;
      void import("../../services/socket").then(({ disconnectSocket }) => disconnectSocket());
    };
  }, [isAuthenticated]);
};
