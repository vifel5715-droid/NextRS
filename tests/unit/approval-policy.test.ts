import { canReviewAtSupervisorStage, needsManagerOnlyItemCheck } from "@/server/policies/approval-policy";

const REVIEWER_ID = "reviewer";
const OTHER_ID = "creator";

function decide(reviewerRole: string, opts: { self?: boolean; creatorRole?: string | null; managerOnly?: boolean } = {}) {
  return canReviewAtSupervisorStage({
    reviewer: { id: REVIEWER_ID, roleKey: reviewerRole },
    creator: { id: opts.self ? REVIEWER_ID : OTHER_ID, roleKey: opts.creatorRole === undefined ? "staff" : opts.creatorRole },
    containsManagerOnlyItem: opts.managerOnly ?? false,
  });
}

describe("Supervisor/Manager-stage approval policy", () => {
  it.each(["staff", "secretary", "custodian", "purchaser", "ap_officer", "director"])(
    "%s cannot review at this stage",
    (role) => {
      expect(decide(role)).toEqual({ allowed: false, reason: "Permission denied." });
    }
  );

  it.each(["supervisor", "manager", "operations_manager", "admin"])("%s can review a staff request", (role) => {
    expect(decide(role)).toEqual({ allowed: true });
  });

  describe("self-review", () => {
    it.each(["supervisor", "operations_manager", "admin"])("%s cannot review their own request", (role) => {
      const result = decide(role, { self: true, creatorRole: role });
      expect(result.allowed).toBe(false);
      expect(result).toHaveProperty("reason", "You cannot review your own request. Another approver must review it.");
    });

    it("a manager may review their own request", () => {
      expect(decide("manager", { self: true, creatorRole: "manager" })).toEqual({ allowed: true });
    });
  });

  it.each(["supervisor", "manager"])("a supervisor cannot review a request created by a %s", (creatorRole) => {
    expect(decide("supervisor", { creatorRole })).toEqual({
      allowed: false,
      reason: "A manager must review requests created by a supervisor or manager.",
    });
  });

  it.each(["manager", "operations_manager", "admin"])("%s can review a supervisor's request", (role) => {
    expect(decide(role, { creatorRole: "supervisor" })).toEqual({ allowed: true });
  });

  it("a supervisor cannot review a request with a manager-only item", () => {
    expect(decide("supervisor", { managerOnly: true })).toEqual({
      allowed: false,
      reason: "A manager must review requests that contain a manager-only item.",
    });
  });

  it("a manager can review a request with a manager-only item", () => {
    expect(decide("manager", { managerOnly: true })).toEqual({ allowed: true });
  });

  it("a request whose creator no longer exists is treated like a staff request", () => {
    expect(decide("supervisor", { creatorRole: null })).toEqual({ allowed: true });
  });

  it("only supervisors need the manager-only item lookup", () => {
    expect(needsManagerOnlyItemCheck("supervisor")).toBe(true);
    expect(needsManagerOnlyItemCheck("manager")).toBe(false);
    expect(needsManagerOnlyItemCheck("admin")).toBe(false);
  });
});
