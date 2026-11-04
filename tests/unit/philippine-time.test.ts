import {
  formatPhtDate,
  formatPhtDateTime,
  formatPhtTime,
  getPhtYear,
  phtDayEndIso,
  phtDayStartIso,
  toPhtDateString,
  toPhtIsoString,
} from "@/lib/utils/timezone";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { formatDate, formatMilitaryTime } from "@/lib/utils/format";

// 2026-11-03T18:30:00Z is 2026-11-04 02:30 in Manila: a different calendar
// day than UTC, and than any zone west of UTC.
const EARLY_MORNING_PHT = "2026-11-03T18:30:00.000Z";

describe("Philippine Time (Asia/Manila) is the system time zone", () => {
  it("reads calendar day and clock in PHT, not UTC or the host zone", () => {
    expect(toPhtDateString(EARLY_MORNING_PHT)).toBe("2026-11-04");
    expect(formatPhtDate(EARLY_MORNING_PHT)).toBe("11/4/2026");
    expect(formatPhtTime(EARLY_MORNING_PHT)).toBe("02:30");
    expect(formatPhtDateTime(EARLY_MORNING_PHT, "", true)).toBe("11/4/2026, 02:30:00 PHT");
    expect(formatDate(EARLY_MORNING_PHT)).toBe("11/04/26");
    expect(formatMilitaryTime(EARLY_MORNING_PHT)).toBe("02:30");
  });

  it("rolls the serial year over at PHT midnight on New Year", () => {
    expect(getPhtYear("2026-12-31T15:59:59.999Z")).toBe(2026);
    expect(getPhtYear("2026-12-31T16:00:00.000Z")).toBe(2027);
  });

  it("treats date-only values as that PHT calendar day", () => {
    expect(toPhtDateString("2026-11-04")).toBe("2026-11-04");
    expect(formatPhtDate("2026-11-04")).toBe("11/4/2026");
  });

  it("builds day bounds for PHT midnight to midnight", () => {
    expect(phtDayStartIso("2026-11-04")).toBe("2026-11-03T16:00:00.000Z");
    expect(phtDayEndIso("2026-11-04")).toBe("2026-11-04T15:59:59.999Z");
  });

  it("filters date ranges by PHT calendar day", () => {
    const rows = [
      { id: 1, created_at: "2026-11-03T15:59:59.999Z" }, // Nov 3, 23:59 PHT
      { id: 2, created_at: EARLY_MORNING_PHT }, // Nov 4, 02:30 PHT
      { id: 3, created_at: "2026-11-04T16:00:00.000Z" }, // Nov 5, 00:00 PHT
    ];
    expect(filterByDateRange(rows, "2026-11-04", "2026-11-04", "created_at").map((r) => r.id)).toEqual([2]);
  });

  it("emits ISO strings with the +08:00 offset", () => {
    expect(toPhtIsoString(EARLY_MORNING_PHT)).toBe("2026-11-04T02:30:00.000+08:00");
    expect(new Date(toPhtIsoString(EARLY_MORNING_PHT)).toISOString()).toBe(EARLY_MORNING_PHT);
  });

  it("returns fallbacks for missing or invalid values", () => {
    expect(formatPhtDate(null, "N/A")).toBe("N/A");
    expect(toPhtDateString("not a date")).toBe("");
  });
});
