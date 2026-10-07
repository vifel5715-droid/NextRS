/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from "react";
import { useAuth } from "./AuthProvider";
import { usePendingItems } from "@features/requests/hooks/usePendingItems";
import type { PendingItem } from "../../services/api";

export const PendingItemsContext = createContext<PendingItem[]>([]);
export const usePendingItemsContext = () => useContext(PendingItemsContext);

export const PendingItemsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const pendingItems = usePendingItems(user?.role, isAuthenticated);
  return (
    <PendingItemsContext.Provider value={pendingItems}>
      {children}
    </PendingItemsContext.Provider>
  );
};
