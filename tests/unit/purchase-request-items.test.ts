/**
 * Custodian Dashboard's Purchase Requests tab: which items count as an active
 * purchase request, and that the shared tab filters apply to them.
 */
import type { ItemRequest, ItemRow } from "@/types";
import {
  formatPrStatus,
  isActivePurchaseRequest,
  prStatusBadgeClass,
  toPurchaseRequestRows,
} from "@/features/approvals/utils/purchaseRequestItems";
import { filterItemTabRows } from "@/features/approvals/utils/closedCancelledItems";

const item = (overrides: Partial<ItemRow>): ItemRow => ({ item_name: "BOLT", quantity: 10, uom: "PC", remarks: "", ...overrides });
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
    items: [
      item({ id: 11, item_name: "BEARING", delivery_status: "PURCHASE REQUEST", pr_number: "PR-100", pr_status: "PENDING" }),
      // Released after its PR was delivered — PR finished, only the snapshot remains.
      item({ id: 12, item_name: "GREASE", delivery_status: "OUT", pr_type: "PURCHASE REQUEST", pr_number: "PR-90", pr_status: "DELIVERED" }),
      item({ id: 13, item_name: "NUT", delivery_status: "URGENT", pr_status: "PENDING" }),
    ],
  }),
  request({
    id: 2,
    serial: "IRS-000002",
    department: "ACCTG",
    purpose: "OFFICE",
    created_at: "2026-10-10T08:00:00.000Z",
    items: [
      item({ id: 21, item_name: "PAPER", delivery_status: "PURCHASE REQUEST", pr_number: "PR-200", pr_status: "DELIVERED PARTIAL", quantity_delivered: 4 }),
      item({ id: 22, item_name: "PEN", delivery_status: "HOLD" }),
      item({ id: 23, item_name: "INK" }),
    ],
  }),
];

describe("isActivePurchaseRequest", () => {
  it.each([
    ["PURCHASE REQUEST", true],
    [" purchase request ", true],
    ["URGENT", false],
    ["OUT", false],
    ["CLOSE", false],
    [undefined, false],
    [null, false],
  ])("%p -> %p", (status, expected) => {
    expect(isActivePurchaseRequest(status)).toBe(expected);
  });
});

describe("toPurchaseRequestRows", () => {
  const rows = toPurchaseRequestRows(requests);

  it("lists only items currently on a purchase request, newest request first", () => {
    expect(rows.map((row) => `${row.serial}:${row.item_name}`)).toEqual(["IRS-000002:PAPER", "IRS-000001:BEARING"]);
  });

  it("excludes finished PRs (item moved on) and Urgent items", () => {
    expect(rows.map((row) => row.item_name)).not.toContain("GREASE");
    expect(rows.map((row) => row.item_name)).not.toContain("NUT");
  });

  it("carries the PR number, status and delivered quantity", () => {
    expect(rows[0]).toMatchObject({
      requestId: 2,
      department: "ACCTG",
      created_by: "JOEL",
      pr_number: "PR-200",
      pr_status: "DELIVERED PARTIAL",
      quantity: 10,
      quantity_delivered: 4,
    });
  });
});

describe("PR status display", () => {
  it.each([
    ["PENDING", "Pending", "bg-warning text-dark"],
    ["", "Pending", "bg-warning text-dark"],
    ["DELIVERED PARTIAL", "Partial Delivered", "bg-info"],
    ["DELIVERED", "Delivered", "bg-success"],
  ])("%p", (status, label, badge) => {
    expect(formatPrStatus(status)).toBe(label);
    expect(prStatusBadgeClass(status)).toBe(badge);
  });
});

describe("filtering purchase request rows", () => {
  const rows = toPurchaseRequestRows(requests);
  const none = { searchQuery: "", department: "all", startDate: "", endDate: "" };
  const names = (filters: Partial<typeof none>) => filterItemTabRows(rows, { ...none, ...filters }).map((row) => row.item_name);

  it("returns every row unfiltered (the badge count)", () => {
    expect(names({})).toHaveLength(2);
  });

  it("searches by PR number, serial and purpose", () => {
    expect(names({ searchQuery: "pr-100" })).toEqual(["BEARING"]);
    expect(names({ searchQuery: "irs-000002" })).toEqual(["PAPER"]);
    expect(names({ searchQuery: "office" })).toEqual(["PAPER"]);
  });

  it("filters by department and date range", () => {
    expect(names({ department: "HR" })).toEqual(["BEARING"]);
    expect(names({ startDate: "2026-10-05" })).toEqual(["PAPER"]);
    expect(names({ endDate: "2026-10-01" })).toEqual(["BEARING"]);
  });
});
