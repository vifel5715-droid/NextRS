/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from "react";
import { useAuth } from "./AuthProvider";
import { useOutedItems } from "@features/items/hooks/useOutedItems";
import type { OutedItem } from "../../services/api";

export const OutedItemsContext = createContext<OutedItem[]>([]);
export const useOutedItemsContext = () => useContext(OutedItemsContext);

export const OutedItemsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const { items } = useOutedItems(isAuthenticated && (user?.permissions.includes("item_list") ?? false));
  return (
    <OutedItemsContext.Provider value={items}>
      {children}
    </OutedItemsContext.Provider>
  );
};
