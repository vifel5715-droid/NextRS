/**
 * Services can't be edited until both approval stages (Supervisor/Manager,
 * then Custodian) have approved — enforced in the Server Actions against the
 * stored approval state, so a direct call can't skip it. The database is a
 * small fake.
 */
import type { AuthorizedUser } from "@/lib/auth";

let currentUser: AuthorizedUser;
jest.mock("@/lib/auth", () => ({ requireUser: async () => currentUser }));
jest.mock("@/lib/realtime", () => ({ publishRequestChanged: jest.fn(async () => undefined) }));
jest.mock("@/server/audit/adjustments", () => ({ logAdjustments: jest.fn(async () => undefined) }));

type Row = Record<string, unknown>;
let serviceRow: Row;
let requestRow: Row;
let siblings: Row[];
const updates: Array<{ patch: Row }> = [];

// Just enough of drizzle's chains for these two actions. A select's result
// depends on what it reads: the locked service line, its request, or (when
// a status changes) the request's sibling lines.
let lockedSelects = 0;
const selectChain = () => ({
  from: () => ({
    where: () => {
      const result = {
        for: async () => (lockedSelects++ === 0 ? [serviceRow] : [requestRow]),
        limit: async () => [requestRow],
        then: (resolve: (rows: Row[]) => unknown) => resolve(siblings),
      };
      return result;
    },
  }),
});
const db = {
  select: selectChain,
  update: () => ({ set: (patch: Row) => ({ where: async () => void updates.push({ patch }) }) }),
  insert: () => ({ values: async () => undefined }),
  delete: () => ({ where: async () => undefined }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
};
jest.mock("@/lib/db", () => ({ getDb: () => db }));

import { updateServiceItemAction, updateServiceRequestAction } from "@/features/requests/actions/service-request-mutations";
import {
  isServiceFulfillmentEditable,
  SERVICE_NOT_APPROVED_MESSAGE,
} from "@/lib/permissions";

const OWNER_ID = "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c";
const userWith = (roleKey: string, overrides: Partial<AuthorizedUser> = {}): AuthorizedUser => ({
  id: "9a0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "PAUL",
  email: "paul",
  role: roleKey,
  roleKey,
  department: "HR",
  permissions: ["department_requests", "create_request", "complete_requests", "held_items"],
  editPermissions: [],
  ...overrides,
});

const withApprovals = (supervisor_status: string | null, custodian_status: string | null) => {
  requestRow = {
    id: 3,
    serial: "SRS-000003",
    department: "HR",
    purpose: "REPAIR",
    remarks: null,
    pr_number: null,
    pr_status: "pending",
    created_by: OWNER_ID,
    requested_by: null,
    supervisor_status,
    custodian_status,
  };
};

beforeEach(() => {
  currentUser = userWith("custodian");
  serviceRow = { id: 30, service_request_id: 3, description: "AIRCON CLEANING", delivery_status: "pending", receiving_report_no: null, pr_number: null, pr_status: null };
  siblings = [{ delivery_status: "completed" }];
  withApprovals("approved", "approved");
  updates.length = 0;
  lockedSelects = 0;
});

describe("isServiceFulfillmentEditable", () => {
  it.each([
    ["approved", "approved", true],
    ["approved", "pending", false],
    ["approved", null, false],
    ["pending", "pending", false],
    [null, null, false],
    ["approved", "rejected", false],
    ["rejected", null, false],
    [" Approved ", "APPROVED", true],
  ])("supervisor=%p custodian=%p -> %p", (supervisor_status, custodian_status, expected) => {
    expect(isServiceFulfillmentEditable({ supervisor_status, custodian_status })).toBe(expected);
  });
});

describe("updateServiceItemAction (a service line)", () => {
  it.each([
    ["Custodian approval still pending", "approved", "pending"],
    ["no approval yet", "pending", "pending"],
    ["declined by the Custodian", "approved", "rejected"],
    ["declined by the Supervisor", "rejected", null],
  ])("blocks a status change when %s", async (_case, supervisor, custodian) => {
    withApprovals(supervisor, custodian);
    const result = await updateServiceItemAction(30, { delivery_status: "completed" });
    expect(result).toEqual({ ok: false, error: SERVICE_NOT_APPROVED_MESSAGE });
    expect(updates).toHaveLength(0);
  });

  it.each([
    ["Receiving Report No.", { receiving_report_no: "RR-1" }],
    ["line PR Number", { pr_number: "PR-1" }],
  ])("blocks the %s while pending", async (_field, input) => {
    withApprovals("approved", "pending");
    expect(await updateServiceItemAction(30, input)).toEqual({ ok: false, error: SERVICE_NOT_APPROVED_MESSAGE });
    expect(updates).toHaveLength(0);
  });

  it("blocks the admin too — there is no bypass", async () => {
    currentUser = userWith("admin");
    withApprovals("approved", "pending");
    expect(await updateServiceItemAction(30, { delivery_status: "holded" })).toEqual({ ok: false, error: SERVICE_NOT_APPROVED_MESSAGE });
  });

  it("lets the Custodian edit once both stages approved", async () => {
    const result = await updateServiceItemAction(30, { delivery_status: "completed" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(updates[0].patch).toMatchObject({ delivery_status: "completed" });
  });

  it("still lets an unchanged resend through while pending (Save resends every line)", async () => {
    withApprovals("approved", "pending");
    expect(await updateServiceItemAction(30, { delivery_status: "pending", description: "AIRCON CLEANING" })).toEqual({ ok: true, data: undefined });
    expect(updates).toHaveLength(0);
  });

  it("keeps refusing roles without fulfillment rights on an approved request", async () => {
    currentUser = userWith("purchaser");
    expect(await updateServiceItemAction(30, { delivery_status: "completed" })).toEqual({ ok: false, error: "Permission denied." });
    expect(updates).toHaveLength(0);
  });
});

describe("updateServiceRequestAction (request header)", () => {
  it("blocks a PR Number / Order Status change while approval is pending", async () => {
    withApprovals("approved", "pending");
    expect(await updateServiceRequestAction(3, { pr_number: "PR-9" })).toEqual({ ok: false, error: SERVICE_NOT_APPROVED_MESSAGE });
    expect(await updateServiceRequestAction(3, { pr_status: "finish" })).toEqual({ ok: false, error: SERVICE_NOT_APPROVED_MESSAGE });
    expect(updates).toHaveLength(0);
  });

  it("allows them once both stages approved", async () => {
    expect(await updateServiceRequestAction(3, { pr_number: "PR-9" })).toEqual({ ok: true, data: undefined });
    expect(updates[0].patch).toMatchObject({ pr_number: "PR-9" });
  });

  it("still refuses PR changes from non-custodian roles", async () => {
    currentUser = userWith("supervisor");
    expect(await updateServiceRequestAction(3, { pr_number: "PR-9" })).toEqual({
      ok: false,
      error: "Only the custodian can change the PR Number or PR Status.",
    });
  });

  it("leaves the requester's pre-review correction rule as it was", async () => {
    currentUser = userWith("staff", { id: OWNER_ID });
    withApprovals("pending", "pending");
    expect(await updateServiceRequestAction(3, { purpose: "REPAIR AIRCON" })).toEqual({ ok: true, data: undefined });

    withApprovals("approved", "pending");
    const reviewed = await updateServiceRequestAction(3, { purpose: "CHANGED" });
    expect(reviewed).toEqual({ ok: false, error: "This request has already been reviewed and can no longer be edited." });
  });
});
