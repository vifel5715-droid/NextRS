import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDeliveredItems } from "@/features/purchase-requests/hooks/useDeliveredItems";
import type { DeliveredItem } from "@/lib/api";

export const DeliveredItemsContext = createContext<DeliveredItem[]>([]);
export const useDeliveredItemsContext = () => useContext(DeliveredItemsContext);

export const DeliveredItemsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const { items } = useDeliveredItems(isAuthenticated && (user?.permissions.includes("delivered_items") ?? false));
  return (
    <DeliveredItemsContext.Provider value={items}>
      {children}
    </DeliveredItemsContext.Provider>
  );
};
