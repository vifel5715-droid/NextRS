/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createLogger } from "@shared/utils/logger";
import { authAPI, setCsrfToken, setUnauthorizedHandler } from "../../services/api";
import type { User } from "@shared/types";

// Re-exported so existing `import type { User } from "@app/providers/AuthProvider"`
// call sites (if any) keep working — the single source of truth is now types/index.ts.
export type { User };

const log = createLogger("AuthContext");

export interface AuthContextType {
  user: User | null;
  login: (user: User, csrfToken?: string) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  loading: boolean;
  refresh: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * ARCH: session state.
 *
 * There is no token in this file, and nothing is written to sessionStorage.
 * The JWT is an httpOnly cookie that only the server can read or clear; the
 * user object lives in React state and is re-fetched from /api/auth/me on
 * every page load. Consequences worth knowing:
 *
 * - `user` is a cache of a server answer, not the source of truth. Every
 *   protected endpoint re-checks the cookie, so a stale `user` in memory
 *   cannot grant access on its own — the role check in ProtectedRoute is UI
 *   convenience, and the server middleware is the actual gate.
 * - Expiry is no longer computed client-side. The old code decoded the JWT's
 *   `exp` and polled it every 60s; with the token unreadable that is both
 *   impossible and unnecessary — the server rejects an expired cookie and the
 *   401 interceptor in services/api.ts drives us back to /login. We also
 *   revalidate when the tab regains focus so an idle tab notices promptly
 *   instead of at the next click.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Read inside event handlers that must not re-subscribe on every change.
  const isAuthedRef = useRef(false);
  isAuthedRef.current = !!user;

  const clearSession = useCallback(() => {
    setUser(null);
    setCsrfToken(null);
  }, []);

  const refresh = useCallback(async (): Promise<User | null> => {
    try {
      const { data } = await authAPI.me();
      setUser(data.user);
      setCsrfToken(data.csrfToken ?? null);
      return data.user;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  // Session restore on mount. The cookie either authenticates us or it
  // doesn't; there is nothing local to parse or validate.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      log.info("Initializing — restoring session from server");
      const restored = await refresh();
      if (cancelled) return;
      log.info(restored ? `Session restored: ${restored.email} (${restored.role})` : "No active session");
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // The API layer calls this when the server reports the session is gone, so
  // a 401 anywhere in the app collapses React state instead of leaving a
  // logged-out user looking at a logged-in shell.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      log.warn("Session rejected by server — clearing local state");
      clearSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Revalidate when the tab comes back to the foreground. Replaces the old
  // 60-second `exp` poll: same "don't leave a dead session on screen" goal,
  // but asks the only party that can actually answer.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && isAuthedRef.current) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const login = useCallback((userData: User, csrf?: string) => {
    log.info("User logged in:", userData.email, `(${userData.role})`);
    // The token is already in the browser's cookie jar — the server set it on
    // the login response. All we hold is the user record and the CSRF token.
    setUser(userData);
    if (csrf) setCsrfToken(csrf);
  }, []);

  const logout = useCallback(async () => {
    log.info("User logged out");
    try {
      // Only the server can clear an httpOnly cookie, so this call is the
      // logout — not a formality. Local state is cleared regardless so a
      // network failure cannot strand the user in a logged-in-looking UI.
      await authAPI.logout();
    } catch {
      log.warn("Logout request failed — clearing local session anyway");
    } finally {
      clearSession();
    }
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{ user, login, logout, isAuthenticated: !!user, loading, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
