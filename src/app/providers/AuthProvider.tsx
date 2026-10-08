/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createLogger } from "@shared/utils/logger";
import { setUnauthorizedHandler } from "../../services/api";
import { getCurrentUserAction, logoutAction } from "@server/actions/auth";
import type { User } from "@shared/types";

// Re-exported so existing `import type { User } from "@app/providers/AuthProvider"`
// call sites (if any) keep working — the single source of truth is now types/index.ts.
export type { User };

const log = createLogger("AuthContext");

export interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  loading: boolean;
  refresh: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * ARCH: session state.
 *
 * The signed session cookie is httpOnly and only the server can read or
 * clear it. The initial user is read from that cookie on the server and
 * passed into React; the in-memory user is only a UI cache. Consequences:
 *
 * - `user` is a cache of a server answer. The role check here only gates UI;
 *   every protected Server Action must independently authorize its caller.
 * - Expiry is checked by the server when it reads the signed cookie. We
 *   revalidate when the tab returns to the foreground so an idle tab notices
 *   an expired session promptly.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode; initialUser: User | null }> = ({
  children,
  initialUser,
}) => {
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(false);

  // Read inside event handlers that must not re-subscribe on every change.
  const isAuthedRef = useRef(false);
  isAuthedRef.current = !!user;

  const clearSession = useCallback(() => {
    setUser(null);
  }, []);

  const refresh = useCallback(async (): Promise<User | null> => {
    const currentUser = await getCurrentUserAction();
    setUser(currentUser);
    return currentUser;
  }, []);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

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
        void refresh().catch((error: unknown) => {
          log.error("Session revalidation failed:", error);
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const login = useCallback((userData: User) => {
    log.info("User logged in:", userData.email, `(${userData.role})`);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    log.info("User logged out");
    try {
      await logoutAction();
    } catch (error: unknown) {
      log.error("Logout action failed — clearing local session anyway:", error);
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
