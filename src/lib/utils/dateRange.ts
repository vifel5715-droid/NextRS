import { getPhtToday, phtDayEndMs, phtDayStartMs, toDate } from "@/lib/utils/timezone";

/** Today as "YYYY-MM-DD" in Philippine Time (Asia/Manila), never the
 * browser's or server host's own time zone. */
export const getTodayDateString = (): string => getPhtToday();

/**
 * Filters rows to those whose date field falls within [startDate, endDate]
 * (inclusive, day-granularity — both are plain "YYYY-MM-DD" strings from a
 * native <input type="date">, read as Philippine Time calendar days). Empty
 * startDate/endDate means "unbounded on that side"; both empty returns rows
 * unfiltered (the "all time" default).
 * Mirrors useRequestManagement.ts's filterByDepartment in shape/usage.
 */
export const filterByDateRange = <T, K extends keyof T>(
  rows: T[],
  startDate: string,
  endDate: string,
  dateKey: K
): T[] => {
  if (!startDate && !endDate) return rows;
  const startMs = startDate ? phtDayStartMs(startDate) : undefined;
  const endMs = endDate ? phtDayEndMs(endDate) : undefined;
  return rows.filter((row) => {
    const value = row[dateKey] as unknown as string | null | undefined;
    const date = toDate(value);
    if (!date) return false;
    const ms = date.getTime();
    if (startMs !== undefined && ms < startMs) return false;
    if (endMs !== undefined && ms > endMs) return false;
    return true;
  });
};
