/**
 * loginAction (the login form's Server Action) and where a signed-in user
 * lands. Data access and cookies are mocked.
 */
import type { User } from "@/types";
import { RateLimitError } from "@/lib/errors";

const setSessionCookie = jest.fn();
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
  clearSessionCookie: jest.fn(),
}));

jest.mock("@/lib/request-context", () => ({ getClientIp: async () => "203.0.113.7" }));

const loggerError = jest.fn();
jest.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => loggerError(...args) } }));

const authenticate = jest.fn();
jest.mock("@/features/auth/services/auth-service", () => ({
  authenticate: (...args: unknown[]) => authenticate(...args),
  signOutEverywhere: jest.fn(),
}));

import { loginAction } from "@/features/auth/actions/auth";
import { landingPathFor } from "@/features/auth/landing-path";

const staff: User = {
  id: "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "JOEL",
  email: "joel",
  role: "staff",
  department: "HR",
  permissions: ["overview", "create_request"],
  editPermissions: [],
};

describe("loginAction", () => {
  it("rejects empty input without touching the database", async () => {
    expect(await loginAction("   ", "pw")).toEqual({ success: false, error: "INVALID_INPUT" });
    expect(await loginAction("joel", "")).toEqual({ success: false, error: "INVALID_INPUT" });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns a generic error for bad credentials and sets no cookie", async () => {
    authenticate.mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await loginAction("joel", "wrong")).toEqual({ success: false, error: "INVALID_CREDENTIALS" });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("reports throttling with its wait message", async () => {
    authenticate.mockRejectedValue(new RateLimitError(120));
    const result = await loginAction("joel", "pw");
    expect(result).toMatchObject({ success: false, error: "RATE_LIMITED" });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("turns a server failure into UNAVAILABLE and logs it, without leaking details", async () => {
    authenticate.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const result = await loginAction("joel", "pw");
    expect(result).toEqual({ success: false, error: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    expect(loggerError).toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("rememberMe=%s sets a persistent cookie: %s", async (rememberMe, persistent) => {
    authenticate.mockResolvedValue({ ok: true, user: staff, sessionVersion: 4 });
    const result = await loginAction("joel", "right", rememberMe);
    expect(result).toEqual({ success: true, user: staff });
    expect(setSessionCookie).toHaveBeenCalledWith(staff.id, 4, { persistent });
  });

  it("only treats a literal true as rememberMe (Server Action arguments are untrusted)", async () => {
    authenticate.mockResolvedValue({ ok: true, user: staff, sessionVersion: 4 });
    await loginAction("joel", "right", "yes" as unknown as boolean);
    expect(setSessionCookie).toHaveBeenCalledWith(staff.id, 4, { persistent: false });
  });
});

describe("landingPathFor", () => {
  const as = (role: string, permissions: string[]) => landingPathFor({ role, permissions });

  it.each([
    ["staff", ["overview", "create_request"]],
    ["custodian", ["overview", "department_requests"]],
    ["purchaser", ["overview", "purchaser_dashboard"]],
    ["ap_officer", ["overview", "ap_officer_dashboard"]],
    ["admin", ["overview", "create_request", "users_management"]],
    ["director", ["overview", "department_requests"]],
  ])("sends %s to the Dashboard when it may open it", (role, permissions) => {
    expect(as(role, permissions)).toBe("/dashboard");
  });

  it.each([
    ["staff", ["create_request"], "/requests/pending"],
    ["supervisor", ["create_request", "supervisor_dashboard"], "/requests/pending"],
    ["custodian", ["department_requests"], "/approvals/custodian"],
    ["purchaser", ["purchaser_dashboard"], "/approvals/purchaser"],
    ["ap_officer", ["ap_officer_dashboard"], "/approvals/ap-officer"],
    ["admin", ["create_request", "users_management"], "/settings"],
  ])("sends %s without the Dashboard to its usual page", (role, permissions, path) => {
    expect(as(role, permissions)).toBe(path);
  });

  it("matches role names case-insensitively, like the server", () => {
    expect(as(" Custodian ", ["department_requests"])).toBe("/approvals/custodian");
  });

  it("falls back to a permitted page when the usual one is not granted", () => {
    expect(as("staff", ["department_requests"])).toBe("/approvals/custodian");
  });

  it("sends roles without a mapped page to the overview dashboard, as before", () => {
    expect(as("operations_manager", ["overview", "supervisor_dashboard", "department_requests"])).toBe("/dashboard");
  });

  it("gives a custom role without the overview its first permitted page", () => {
    expect(as("auditor", ["department_requests"])).toBe("/approvals/custodian");
  });

  it("sends a user with no page permissions to /unauthorized", () => {
    expect(as("staff", [])).toBe("/unauthorized");
  });
});
