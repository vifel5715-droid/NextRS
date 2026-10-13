import React, { createContext, useContext, useMemo, useState } from "react";
import { getTodayDateString } from "@/lib/utils/dateRange";

export interface DateRangeContextValue {
  /** "" (unbounded) or a "YYYY-MM-DD" string from a native <input type="date">. */
  startDate: string;
  /** Defaults to today — "" here would mean "no upper bound" rather than
   * "up to now", which isn't what an empty End Date should imply. */
  endDate: string;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  /** Back to the defaults: no Start Date, End Date = today. */
  reset: () => void;
}

const DateRangeContext = createContext<DateRangeContextValue>({
  startDate: "",
  endDate: "",
  setStartDate: () => {},
  setEndDate: () => {},
  reset: () => {},
});

export const useDateRangeContext = () => useContext(DateRangeContext);

/**
 * Shared Start/End Date filter — every sidebar badge count and every list
 * page's table narrows to this range once set. Start Date defaults to unset
 * (no lower bound); End Date defaults to today, matching the app's behavior
 * before this filter existed (nothing is dated in the future, so filtering
 * up to today is equivalent to "all time" for real data).
 */
export const DateRangeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(getTodayDateString);

  const value = useMemo<DateRangeContextValue>(() => ({
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    reset: () => { setStartDate(""); setEndDate(getTodayDateString()); },
  }), [startDate, endDate]);

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
};
