import type { AuthorizedUser } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import {
  assertCanEditRequest,
  canEditRequest,
  isDepartmentScoped,
  isRequestOwner,
  requireDepartmentAccess,
  requirePermission,
  requireRole,
} from "@/lib/permissions";

function user(overrides: Partial<AuthorizedUser> = {}): AuthorizedUser {
  return {
    id: "user-1",
    name: "JANE DOE",
    email: "jane",
    role: "staff",
    roleKey: "staff",
    department: "HR",
    permissions: ["create_request"],
    editPermissions: [],
    ...overrides,
  };
}

const request = (overrides = {}) => ({
  created_by: "user-1",
  requested_by: null as string | null,
  supervisor_status: "pending" as string | null,
  custodian_status: null as string | null,
  ...overrides,
});

describe("requirePermission / requireRole", () => {
  it("allows a granted page permission", () => {
    expect(() => requirePermission(user(), ["create_request"])).not.toThrow();
  });

  it("denies a missing permission with a 403 error", () => {
    expect(() => requirePermission(user(), ["users_management"])).toThrow(ForbiddenError);
  });

  it("lets admin through every page permission", () => {
    expect(() => requirePermission(user({ roleKey: "admin", permissions: [] }), ["users_management"])).not.toThrow();
  });

  it("checks the role key exactly", () => {
    expect(() => requireRole(user({ roleKey: "custodian" }), ["custodian", "admin"])).not.toThrow();
    expect(() => requireRole(user(), ["custodian", "admin"])).toThrow(ForbiddenError);
  });
});

describe("department access", () => {
  it.each(["staff", "secretary", "supervisor", "manager", "some_custom_role"])("%s is department-scoped", (roleKey) => {
    expect(isDepartmentScoped(user({ roleKey }))).toBe(true);
  });

  it.each(["custodian", "admin", "director", "purchaser", "ap_officer", "operations_manager"])(
    "%s sees every department",
    (roleKey) => {
      expect(isDepartmentScoped(user({ roleKey }))).toBe(false);
    }
  );

  it("allows the user's own department, case and whitespace insensitive", () => {
    expect(() => requireDepartmentAccess(user({ department: "hr" }), " HR ")).not.toThrow();
  });

  it.each(["ENGG", "QA", "ACCTG", "PROD"])("blocks a scoped user from %s", (department) => {
    expect(() => requireDepartmentAccess(user(), department)).toThrow("You do not have access to this request.");
  });

  it("lets an unscoped role into any department", () => {
    expect(() => requireDepartmentAccess(user({ roleKey: "custodian" }), "ENGG")).not.toThrow();
  });
});

describe("request ownership and editing", () => {
  it("treats the creator or the named requester as owner", () => {
    expect(isRequestOwner(user(), request())).toBe(true);
    expect(isRequestOwner(user({ id: "other" }), request({ requested_by: "jane doe" }))).toBe(true);
    expect(isRequestOwner(user({ id: "other" }), request())).toBe(false);
  });

  it("lets staff edit their own pending request", () => {
    expect(canEditRequest(user(), request())).toEqual({ allowed: true });
  });

  it("blocks staff from editing someone else's request", () => {
    expect(canEditRequest(user({ id: "other" }), request())).toEqual({
      allowed: false,
      reason: "You can only edit your own request.",
    });
  });

  it.each([
    { supervisor_status: "approved" },
    { supervisor_status: "rejected" },
    { custodian_status: "approved" },
  ])("blocks staff and secretary once reviewed (%p)", (status) => {
    expect(canEditRequest(user(), request(status)).allowed).toBe(false);
    expect(canEditRequest(user({ roleKey: "secretary", id: "other" }), request(status)).allowed).toBe(false);
  });

  it("lets a secretary edit another person's pending request", () => {
    expect(canEditRequest(user({ roleKey: "secretary", id: "other" }), request()).allowed).toBe(true);
  });

  it.each(["supervisor", "manager", "operations_manager"])("blocks %s once the request is supervisor-approved", (roleKey) => {
    expect(canEditRequest(user({ roleKey, id: "other" }), request()).allowed).toBe(true);
    expect(canEditRequest(user({ roleKey, id: "other" }), request({ supervisor_status: "approved" }))).toEqual({
      allowed: false,
      reason: "This request has already been approved and can no longer be edited.",
    });
  });

  it("still lets admin edit an approved request", () => {
    expect(canEditRequest(user({ roleKey: "admin", id: "other" }), request({ supervisor_status: "approved" })).allowed).toBe(true);
  });

  it("leaves other roles to their page permission and department checks", () => {
    expect(canEditRequest(user({ roleKey: "custodian", id: "other" }), request({ custodian_status: "approved" })).allowed).toBe(true);
  });

  it("assertCanEditRequest throws a ForbiddenError with the reason", () => {
    expect(() => assertCanEditRequest(user({ id: "other" }), request())).toThrow(
      new ForbiddenError("You can only edit your own request.")
    );
  });
});
