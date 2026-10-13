/**
 * Sign-in flow: throttling, constant-time handling of unknown usernames,
 * failure bookkeeping and auditing. Persistence is mocked.
 */
import { RateLimitError } from "@/lib/errors";

const checkLoginThrottle = jest.fn();
const recordLoginFailure = jest.fn();
const clearLoginFailures = jest.fn();
jest.mock("@/server/services/login-throttle", () => ({
  checkLoginThrottle: (...a: unknown[]) => checkLoginThrottle(...a),
  recordLoginFailure: (...a: unknown[]) => recordLoginFailure(...a),
  clearLoginFailures: (...a: unknown[]) => clearLoginFailures(...a),
}));

const findAccountByUsername = jest.fn();
const incrementSessionVersion = jest.fn();
jest.mock("@/server/repositories/user-repository", () => ({
  findAccountByUsername: (...a: unknown[]) => findAccountByUsername(...a),
  incrementSessionVersion: (...a: unknown[]) => incrementSessionVersion(...a),
  toUser: async (account: Record<string, unknown>) => {
    const { passwordHash: _h, sessionVersion: _v, ...user } = account;
    return { ...user, permissions: ["create_request"], editPermissions: [] };
  },
}));

const verifyPassword = jest.fn();
jest.mock("@/lib/password", () => ({
  hashPassword: async () => "$dummy-hash",
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
}));

const recordAuditSafely = jest.fn();
jest.mock("@/server/audit/audit-log", () => ({ recordAuditSafely: (...a: unknown[]) => recordAuditSafely(...a) }));

import { authenticate, signOutEverywhere } from "@/features/auth/services/auth-service";

const account = {
  id: "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "JOEL",
  email: "joel",
  role: "staff",
  department: "HR",
  passwordHash: "$argon2id$real",
  sessionVersion: 2,
};
const IP = "203.0.113.7";

beforeEach(() => checkLoginThrottle.mockResolvedValue({ limited: false }));

it("signs in with the right password, clears failures and audits", async () => {
  findAccountByUsername.mockResolvedValue(account);
  verifyPassword.mockResolvedValue(true);

  const result = await authenticate({ username: " Joel ", password: "right" }, IP);

  expect(result).toEqual({
    ok: true,
    sessionVersion: 2,
    user: { id: account.id, name: "JOEL", email: "joel", role: "staff", department: "HR", permissions: ["create_request"], editPermissions: [] },
  });
  expect(checkLoginThrottle).toHaveBeenCalledWith("joel", IP);
  expect(clearLoginFailures).toHaveBeenCalledWith("joel");
  expect(recordLoginFailure).not.toHaveBeenCalled();
  expect(recordAuditSafely).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login", ip: IP }));
  expect(JSON.stringify(result)).not.toContain("argon2");
});

it("records a failure for a wrong password", async () => {
  findAccountByUsername.mockResolvedValue(account);
  verifyPassword.mockResolvedValue(false);

  await expect(authenticate({ username: "joel", password: "wrong" }, IP)).resolves.toEqual({
    ok: false,
    reason: "INVALID_CREDENTIALS",
  });
  expect(recordLoginFailure).toHaveBeenCalledWith("joel", IP);
  expect(recordAuditSafely).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login_failed" }));
  expect(clearLoginFailures).not.toHaveBeenCalled();
});

it("still runs a password hash check for an unknown username (no timing oracle)", async () => {
  findAccountByUsername.mockResolvedValue(null);
  verifyPassword.mockResolvedValue(true); // even a "match" against the dummy hash must fail

  await expect(authenticate({ username: "ghost", password: "anything" }, IP)).resolves.toEqual({
    ok: false,
    reason: "INVALID_CREDENTIALS",
  });
  expect(verifyPassword).toHaveBeenCalledWith("$dummy-hash", "anything");
  expect(recordLoginFailure).toHaveBeenCalledWith("ghost", IP);
});

it("refuses a throttled username before checking the password", async () => {
  checkLoginThrottle.mockResolvedValue({ limited: true, retryAfterSeconds: 300 });

  await expect(authenticate({ username: "joel", password: "right" }, IP)).rejects.toBeInstanceOf(RateLimitError);
  expect(findAccountByUsername).not.toHaveBeenCalled();
  expect(verifyPassword).not.toHaveBeenCalled();
  expect(recordAuditSafely).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login_throttled" }));
});

it("never writes the password to the audit trail", async () => {
  findAccountByUsername.mockResolvedValue(account);
  verifyPassword.mockResolvedValue(false);
  await authenticate({ username: "joel", password: "Sup3rSecret!" }, IP);
  expect(JSON.stringify(recordAuditSafely.mock.calls)).not.toContain("Sup3rSecret!");
});

it("logout revokes every session by bumping the session version", async () => {
  await signOutEverywhere({ id: account.id, name: account.name }, IP);
  expect(incrementSessionVersion).toHaveBeenCalledWith(account.id);
  expect(recordAuditSafely).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.logout" }));
});
