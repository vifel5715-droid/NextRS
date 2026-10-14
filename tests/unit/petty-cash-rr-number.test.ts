/**
 * setPettyCashRrNumberAction: only Custodian/admin may set the RR No.; the
 * value is validated, upper-cased, can be cleared, and every real change is
 * written to the History (adjustment_log). The database is a small fake.
 */
import type { AuthorizedUser } from "@/lib/auth";

let currentUser: AuthorizedUser;
jest.mock("@/lib/auth", () => ({ requireUser: async () => currentUser }));
jest.mock("@/lib/realtime", () => ({ publishRequestChanged: jest.fn(async () => undefined) }));
jest.mock("@/server/services/serial-numbers", () => ({ lockSerialSequence: jest.fn(), nextSerial: jest.fn() }));
jest.mock("@/server/audit/adjustments", () => ({ nextAdjustmentSerial: async () => "ADJ-2026-000001" }));

let storedRow: { id: number; serial: string; rr_number: string | null } | null;
const updates: Array<Record<string, unknown>> = [];
const logInserts: Array<Array<Record<string, unknown>>> = [];

// Just enough of drizzle's chain for this action.
const tx = {
  select: () => ({ from: () => ({ where: () => ({ for: async () => (storedRow ? [storedRow] : []) }) }) }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: async () => {
        updates.push(patch);
      },
    }),
  }),
  insert: () => ({
    values: async (rows: Array<Record<string, unknown>>) => {
      logInserts.push(rows);
    },
  }),
};
jest.mock("@/lib/db", () => ({
  getDb: () => ({ transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }),
}));

import { publishRequestChanged } from "@/lib/realtime";
import { setPettyCashRrNumberAction } from "@/features/petty-cash/actions/petty-cash";

const userWith = (roleKey: string): AuthorizedUser => ({
  id: "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "PAUL",
  email: "paul",
  role: roleKey,
  roleKey,
  department: "ACCTG",
  permissions: ["petty_cash"],
  editPermissions: ["petty_cash"],
});

beforeEach(() => {
  currentUser = userWith("custodian");
  storedRow = { id: 7, serial: "CP-2026-000007", rr_number: null };
  updates.length = 0;
  logInserts.length = 0;
});

describe("setPettyCashRrNumberAction", () => {
  it.each(["custodian", "admin"])("lets %s set it, upper-cased and trimmed, and logs it", async (role) => {
    currentUser = userWith(role);
    const result = await setPettyCashRrNumberAction(7, { rr_number: "  rr-0042 " });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates).toEqual([expect.objectContaining({ rr_number: "RR-0042" })]);
    expect(logInserts[0]).toEqual([
      expect.objectContaining({ field: "RR No.", before_value: "", after_value: "RR-0042", request_type: "petty_cash" }),
    ]);
    expect(publishRequestChanged).toHaveBeenCalled();
  });

  it.each(["ap_officer", "staff", "purchaser"])("rejects %s without touching the row", async (role) => {
    currentUser = userWith(role);
    const result = await setPettyCashRrNumberAction(7, { rr_number: "RR-1" });
    expect(result).toEqual({ ok: false, error: "Only a Custodian can enter the RR No." });
    expect(updates).toHaveLength(0);
  });

  it("rejects a user without the petty_cash permission", async () => {
    currentUser = { ...userWith("custodian"), permissions: [] };
    const result = await setPettyCashRrNumberAction(7, { rr_number: "RR-1" });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("clears it with an empty value", async () => {
    storedRow = { id: 7, serial: "CP-2026-000007", rr_number: "RR-0042" };
    await setPettyCashRrNumberAction(7, { rr_number: "" });
    expect(updates).toEqual([expect.objectContaining({ rr_number: null })]);
    expect(logInserts[0][0]).toMatchObject({ before_value: "RR-0042", after_value: "" });
  });

  it("does nothing when the value is unchanged", async () => {
    storedRow = { id: 7, serial: "CP-2026-000007", rr_number: "RR-0042" };
    await setPettyCashRrNumberAction(7, { rr_number: "rr-0042" });
    expect(updates).toHaveLength(0);
    expect(logInserts).toHaveLength(0);
    expect(publishRequestChanged).not.toHaveBeenCalled();
  });

  it.each([
    [{ rr_number: "x".repeat(101) }, "RR No. must be at most 100 characters."],
    [{ rr_number: 42 }, "RR No. must be text."],
  ])("validates %p", async (input, error) => {
    expect(await setPettyCashRrNumberAction(7, input)).toEqual({ ok: false, error });
    expect(updates).toHaveLength(0);
  });

  it("reports a missing transaction", async () => {
    storedRow = null;
    expect(await setPettyCashRrNumberAction(7, { rr_number: "RR-1" })).toEqual({
      ok: false,
      error: "Petty Cash transaction not found.",
    });
  });
});
