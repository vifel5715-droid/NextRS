/**
 * Custodian Dashboard's Closed / Cancelled tab: which items appear, and how
 * the shared search/department/date filters apply to them.
 */
import type { ItemRequest, ItemRow } from "@/types";
import {
  closedCancelledStatusOf,
  filterClosedCancelledRows,
  toClosedCancelledRows,
} from "@/features/approvals/utils/closedCancelledItems";

const item = (overrides: Partial<ItemRow>): ItemRow => ({
  item_name: "BALL BEARING",
  quantity: 2,
  uom: "PC",
  remarks: "",
  ...overrides,
});

const request = (overrides: Partial<ItemRequest>): ItemRequest => ({
  id: 1,
  serial: "IRS-000001",
  created_at: "2026-10-01T08:00:00.000Z",
  created_by: "JOEL",
  department: "HR",
  purpose: "MAINTENANCE",
  remarks: "",
  status: "approved",
  ...overrides,
});

const requests: ItemRequest[] = [
  request({
    id: 1,
    serial: "IRS-000001",
    items: [
      item({ id: 11, item_name: "BEARING", delivery_status: "CLOSE", status_reason: "No longer needed" }),
      item({ id: 12, item_name: "BOLT", delivery_status: "OUT" }),
      item({ id: 13, item_name: "NUT", delivery_status: "cancel", status_reason: "Duplicate", pr_number: "PR-77" }),
    ],
  }),
  request({
    id: 2,
    serial: "IRS-000002",
    department: "ACCTG",
    purpose: "OFFICE SUPPLIES",
    created_at: "2026-10-10T08:00:00.000Z",
    items: [
      item({ id: 21, item_name: "PAPER", delivery_status: "CANCEL", status_reason: "Wrong item" }),
      item({ id: 22, item_name: "PEN", delivery_status: "HOLD" }),
      item({ id: 23, item_name: "INK", delivery_status: "PURCHASE REQUEST" }),
      item({ id: 24, item_name: "TAPE" }),
    ],
  }),
  request({ id: 3, serial: "IRS-000003", items: [item({ id: 31, delivery_status: "OUT" })] }),
];

describe("closedCancelledStatusOf", () => {
  it.each([
    ["CLOSE", "CLOSE"],
    ["CANCEL", "CANCEL"],
    [" cancel ", "CANCEL"],
    ["OUT", null],
    ["HOLD", null],
    ["PURCHASE REQUEST", null],
    ["completed", null],
    [undefined, null],
    [null, null],
  ])("%p -> %p", (input, expected) => {
    expect(closedCancelledStatusOf(input)).toBe(expected);
  });
});

describe("toClosedCancelledRows", () => {
  const rows = toClosedCancelledRows(requests);

  it("includes only items currently CLOSE or CANCEL, one row per item", () => {
    expect(rows.map((row) => `${row.serial}:${row.item_name}:${row.status}`)).toEqual([
      "IRS-000002:PAPER:CANCEL",
      "IRS-000001:BEARING:CLOSE",
      "IRS-000001:NUT:CANCEL",
    ]);
  });

  it("carries the parent request's details and the item's reason", () => {
    expect(rows.find((row) => row.item_name === "NUT")).toMatchObject({
      requestId: 1,
      department: "HR",
      created_by: "JOEL",
      purpose: "MAINTENANCE",
      pr_number: "PR-77",
      reason: "Duplicate",
      quantity: 2,
      uom: "PC",
    });
  });

  it("gives every row a unique key", () => {
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("is empty when nothing is closed or cancelled", () => {
    expect(toClosedCancelledRows([requests[2]])).toEqual([]);
    expect(toClosedCancelledRows([request({ items: undefined })])).toEqual([]);
  });
});

describe("filterClosedCancelledRows", () => {
  const rows = toClosedCancelledRows(requests);
  const none = { searchQuery: "", department: "all", startDate: "", endDate: "" };
  const names = (filters: Partial<typeof none>) =>
    filterClosedCancelledRows(rows, { ...none, ...filters }).map((row) => row.item_name);

  it("returns everything with no filters (the badge count)", () => {
    expect(names({})).toHaveLength(3);
  });

  it.each([
    ["serial", "irs-000002", ["PAPER"]],
    ["purpose", "maintenance", ["BEARING", "NUT"]],
    ["PR number", "pr-77", ["NUT"]],
    ["item name", "bearing", ["BEARING"]],
    ["reason", "wrong item", ["PAPER"]],
  ])("searches by %s", (_field, searchQuery, expected) => {
    expect(names({ searchQuery })).toEqual(expected);
  });

  it("filters by department", () => {
    expect(names({ department: "ACCTG" })).toEqual(["PAPER"]);
    expect(names({ department: "HR" })).toEqual(["BEARING", "NUT"]);
  });

  it("filters by the request's created date, inclusive", () => {
    expect(names({ startDate: "2026-10-05" })).toEqual(["PAPER"]);
    expect(names({ endDate: "2026-10-01" })).toEqual(["BEARING", "NUT"]);
    expect(names({ startDate: "2026-10-02", endDate: "2026-10-09" })).toEqual([]);
  });

  it("combines filters", () => {
    expect(names({ searchQuery: "irs", department: "HR", startDate: "2026-09-01" })).toEqual(["BEARING", "NUT"]);
  });
});
