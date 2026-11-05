/**
 * Summary Requests bulk delete: admin-only, ids validated on the server, and
 * only rows that still exist are deleted (each with an audit entry). The
 * database is a small fake that records what the action does.
 */
import type { AuthorizedUser } from "@/lib/auth";

let currentUser: AuthorizedUser;
jest.mock("@/lib/auth", () => ({ requireUser: async () => currentUser }));
const publishRequestChanged = jest.fn(async () => undefined);
jest.mock("@/lib/realtime", () => ({ publishRequestChanged: (...args: unknown[]) => publishRequestChanged(...(args as [])) }));
const recordAudit = jest.fn(async () => undefined);
jest.mock("@/server/audit/audit-log", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...(args as [])) }));

import { itemRequests, reimbursementRequests, serviceRequests, urgentRequests } from "@/db/schema";

type Row = { id: number; serial: string; department: string };
// Rows that "exist" per table; selects return all of them for that table.
let existing: Map<unknown, Row[]>;
const deletes: Array<{ table: unknown }> = [];
let transactions = 0;

const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({ for: async () => existing.get(table) ?? [] }),
    }),
  }),
  delete: (table: unknown) => ({ where: async () => void deletes.push({ table }) }),
  insert: () => ({ values: async () => undefined }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    transactions += 1;
    return fn(db);
  },
};
jest.mock("@/lib/db", () => ({ getDb: () => db }));

import { deleteSelectedRequestsAction } from "@/features/requests/actions/admin-request-deletions";

const userWith = (roleKey: string): AuthorizedUser => ({
  id: "9a0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "ADMIN USER",
  email: "admin",
  role: roleKey,
  roleKey,
  department: "IT",
  permissions: [],
  editPermissions: [],
});

beforeEach(() => {
  currentUser = userWith("admin");
  existing = new Map();
  deletes.length = 0;
  transactions = 0;
  publishRequestChanged.mockClear();
  recordAudit.mockClear();
});

describe("deleteSelectedRequestsAction", () => {
  it.each(["staff", "supervisor", "custodian", "purchaser"])("rejects the %s role without touching the database", async (role) => {
    currentUser = userWith(role);
    const result = await deleteSelectedRequestsAction([{ type: "item", id: 1 }]);
    expect(result.ok).toBe(false);
    expect(transactions).toBe(0);
  });

  it.each([
    ["an empty selection", []],
    ["a non-array", "1,2" as unknown],
    ["an unknown type", [{ type: "petty_cash", id: 1 }]],
    ["a non-integer id", [{ type: "item", id: 1.5 }]],
    ["a zero id", [{ type: "item", id: 0 }]],
    ["a string id", [{ type: "item", id: "1" }]],
  ])("rejects %s", async (_label, input) => {
    const result = await deleteSelectedRequestsAction(input as never);
    expect(result.ok).toBe(false);
    expect(transactions).toBe(0);
  });

  it("rejects more than 1000 requests at once", async () => {
    const input = Array.from({ length: 1001 }, (_, i) => ({ type: "item" as const, id: i + 1 }));
    expect((await deleteSelectedRequestsAction(input)).ok).toBe(false);
  });

  it("deletes every selected type, audits each request, and notifies listeners", async () => {
    existing.set(itemRequests, [{ id: 1, serial: "IRS-2026-000001", department: "HR" }]);
    existing.set(serviceRequests, [{ id: 2, serial: "SRS-2026-000002", department: "IT" }]);
    existing.set(urgentRequests, [{ id: 3, serial: "URG-2026-000003", department: "HR" }]);
    existing.set(reimbursementRequests, [{ id: 4, serial: "RMB-2026-000004", department: "HR" }]);

    const result = await deleteSelectedRequestsAction([
      { type: "item", id: 1 },
      { type: "item", id: 1 }, // duplicate
      { type: "service", id: 2 },
      { type: "urgent", id: 3 },
      { type: "reimbursement", id: 4 },
    ]);

    expect(result).toEqual({ ok: true, data: { deleted: 4, notFound: 0 } });
    expect(transactions).toBe(1);
    expect(deletes.map((d) => d.table)).toEqual([itemRequests, serviceRequests, urgentRequests, reimbursementRequests]);
    expect(recordAudit).toHaveBeenCalledTimes(4);
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: "request.deleted", entityType: "item_request", entityId: 1 })
    );
    expect(publishRequestChanged).toHaveBeenCalledWith({ type: "urgent", action: "deleted", id: 3, department: "HR" });
  });

  it("counts requests that no longer exist as not found", async () => {
    existing.set(itemRequests, [{ id: 1, serial: "IRS-2026-000001", department: "HR" }]);
    const result = await deleteSelectedRequestsAction([
      { type: "item", id: 1 },
      { type: "item", id: 99 },
      { type: "service", id: 5 },
    ]);
    expect(result).toEqual({ ok: true, data: { deleted: 1, notFound: 2 } });
    expect(deletes).toHaveLength(1);
  });
});
