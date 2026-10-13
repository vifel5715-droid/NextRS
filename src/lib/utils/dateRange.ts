/** Today as a "YYYY-MM-DD" string in the browser's local timezone — built
 * from the local Y/M/D fields rather than toISOString() (which is UTC and
 * can land on the wrong day near midnight in timezones ahead of UTC). */
export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Filters rows to those whose date field falls within [startDate, endDate]
 * (inclusive, day-granularity — both are plain "YYYY-MM-DD" strings from a
 * native <input type="date">). Empty startDate/endDate means "unbounded on
 * that side"; both empty returns rows unfiltered (the "all time" default).
 * Mirrors useRequestManagement.ts's filterByDepartment in shape/usage.
 */
export const filterByDateRange = <T, K extends keyof T>(
  rows: T[],
  startDate: string,
  endDate: string,
  dateKey: K
): T[] => {
  if (!startDate && !endDate) return rows;
  const startMs = startDate ? new Date(startDate).getTime() : undefined;
  const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : undefined;
  return rows.filter((row) => {
    const value = row[dateKey] as unknown as string | null | undefined;
    if (!value) return false;
    const ms = new Date(value).getTime();
    if (startMs !== undefined && ms < startMs) return false;
    if (endMs !== undefined && ms > endMs) return false;
    return true;
  });
};
