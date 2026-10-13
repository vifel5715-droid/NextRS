import React, { createContext, useContext, useMemo } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { useMyRequestsProcessingCount } from "@/features/dashboard/hooks/useMyRequestsProcessingCount";
import { useDashboardSummary } from "@/features/dashboard/hooks/useDashboardSummary";
import { useAdjustmentLog } from "@/features/reports/hooks/useAdjustmentLog";

export interface DashboardCounts {
  myRequestsProcessingCount: number;
  summary: ReturnType<typeof useDashboardSummary>;
  adjustmentLog: ReturnType<typeof useAdjustmentLog>;
}

const emptyCounts: DashboardCounts = {
  myRequestsProcessingCount: 0,
  summary: {
    completeRequestsCount: 0,
    heldItemsCount: 0,
    itemListCount: 0,
    deletedCount: 0,
    totalRequestsCount: 0,
    loading: true,
  },
  adjustmentLog: { entries: [], loading: true },
};

const DashboardCountsContext = createContext<DashboardCounts>(emptyCounts);
export const useDashboardCounts = () => useContext(DashboardCountsContext);

/**
 * One owner for the counts the Sidebar badges, the Main Dashboard tiles and
 * the Adjustment History page all read. Each of those used to run its own
 * copy of these hooks, so opening the dashboard fired every request twice
 * and every realtime event refetched them twice. Mounted inside the
 * persistent app shell (logged-in users only), so it fetches once and stays
 * fresh through realtime events instead of refetching on every navigation.
 */
export const DashboardCountsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;

  const myRequestsProcessingCount = useMyRequestsProcessingCount(user?.role, user?.name, user?.department, startDate, endDate);
  const summary = useDashboardSummary(hasPermission("deleted_items"));
  const adjustmentLog = useAdjustmentLog(hasPermission("adjustment_history"));

  const value = useMemo<DashboardCounts>(
    () => ({ myRequestsProcessingCount, summary, adjustmentLog }),
    [myRequestsProcessingCount, summary, adjustmentLog]
  );

  return <DashboardCountsContext.Provider value={value}>{children}</DashboardCountsContext.Provider>;
};
