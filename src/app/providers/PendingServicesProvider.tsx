/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from "react";
import { useAuth } from "./AuthProvider";
import { usePendingServices } from "@features/requests/hooks/usePendingServices";
import type { PendingService } from "../../services/api";

export const PendingServicesContext = createContext<PendingService[]>([]);
export const usePendingServicesContext = () => useContext(PendingServicesContext);

export const PendingServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const pendingServices = usePendingServices(user?.role, isAuthenticated);
  return (
    <PendingServicesContext.Provider value={pendingServices}>
      {children}
    </PendingServicesContext.Provider>
  );
};
