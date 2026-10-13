/**
 * Route Handlers: authentication is enforced server-side and errors use the
 * standard `{ error: { code, message } }` shape. Data access is mocked.
 */
import type { User } from "@/types";
import { NotFoundError, RateLimitError } from "@/lib/errors";

const getCurrentUser = jest.fn<Promise<User | null>, []>();
const setSessionCookie = jest.fn();
jest.mock("@/lib/session", () => ({
  getCurrentUser: () => getCurrentUser(),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
  clearSessionCookie: jest.fn(),
}));

const getItemRequestByIdAction = jest.fn();
const getRequestListsAction = jest.fn();
jest.mock("@/features/requests/actions/request-lists", () => ({
  getItemRequestByIdAction: (id: number) => getItemRequestByIdAction(id),
  getServiceRequestByIdAction: jest.fn(),
  getRequestListsAction: () => getRequestListsAction(),
  getMyRequestListsAction: jest.fn(),
}));

const authenticate = jest.fn();
jest.mock("@/features/auth/services/auth-service", () => ({
  authenticate: (...args: unknown[]) => authenticate(...args),
  signOutEverywhere: jest.fn(),
}));

import { GET as getMe } from "@/app/api/auth/me/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as listRequests } from "@/app/api/requests/route";
import { GET as getRequest } from "@/app/api/requests/[requestId]/route";
import { GET as unknownApi } from "@/app/api/[...path]/route";

const staff: User = {
  id: "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "JOEL",
  email: "joel",
  role: "staff",
  department: "HR",
  permissions: ["create_request"],
  editPermissions: [],
};

const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) });
const loginRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("unauthenticated API access", () => {
  beforeEach(() => getCurrentUser.mockResolvedValue(null));

  it.each([
    ["GET /api/auth/me", () => getMe(new Request("http://localhost/api/auth/me"), undefined)],
    ["GET /api/requests", () => listRequests(new Request("http://localhost/api/requests"), undefined)],
    ["GET /api/requests/1", () => getRequest(new Request("http://localhost/api/requests/1"), params("1"))],
  ])("%s returns 401 without touching data", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Your session has expired. Please log in again." },
    });
    expect(getRequestListsAction).not.toHaveBeenCalled();
    expect(getItemRequestByIdAction).not.toHaveBeenCalled();
  });
});

describe("authenticated API access", () => {
  beforeEach(() => getCurrentUser.mockResolvedValue(staff));

  it("GET /api/auth/me returns the user without internal fields", async () => {
    const response = await getMe(new Request("http://localhost/api/auth/me"), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ user: staff });
    expect(JSON.stringify(body)).not.toMatch(/password|hash|roleKey/i);
  });

  it("rejects a malformed request id with 400", async () => {
    const response = await getRequest(new Request("http://localhost/api/requests/abc"), params("abc"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a request the user may not see", async () => {
    getItemRequestByIdAction.mockRejectedValue(new NotFoundError("Item request not found or access denied."));
    const response = await getRequest(new Request("http://localhost/api/requests/7?type=item"), params("7"));
    expect(response.status).toBe(404);
  });

  it("returns a generic 500 and no internals for unexpected failures", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    getRequestListsAction.mockRejectedValue(new TypeError("connect ECONNREFUSED 127.0.0.1:5432"));
    const response = await listRequests(new Request("http://localhost/api/requests"), undefined);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("ECONNREFUSED");
    spy.mockRestore();
  });

  it("filters the list by type", async () => {
    getRequestListsAction.mockResolvedValue({ itemRequests: [{ id: 1 }], serviceRequests: [{ id: 2 }] });
    const response = await listRequests(new Request("http://localhost/api/requests?type=service"), undefined);
    expect(await response.json()).toEqual({ serviceRequests: [{ id: 2 }] });
  });
});

describe("POST /api/auth/login", () => {
  it("rejects cross-origin browser requests (CSRF)", async () => {
    const response = await login(loginRequest({ username: "joel", password: "pw" }, { origin: "https://evil.example" }), undefined);
    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    const response = await login(loginRequest({ username: "" }), undefined);
    expect(response.status).toBe(400);
  });

  it("returns 401 for bad credentials without setting a cookie", async () => {
    authenticate.mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" });
    const response = await login(loginRequest({ username: "joel", password: "wrong" }), undefined);
    expect(response.status).toBe(401);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when throttled", async () => {
    authenticate.mockRejectedValue(new RateLimitError(120));
    const response = await login(loginRequest({ username: "joel", password: "pw" }), undefined);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
  });

  it("sets the session cookie on success", async () => {
    authenticate.mockResolvedValue({ ok: true, user: staff, sessionVersion: 4 });
    const response = await login(
      loginRequest({ username: "joel", password: "right" }, { origin: "http://localhost:3000" }),
      undefined
    );
    expect(response.status).toBe(200);
    expect(setSessionCookie).toHaveBeenCalledWith(staff.id, 4);
    expect(await response.json()).toEqual({ user: staff });
  });
});

it("unknown /api paths return a JSON 404", async () => {
  const response = unknownApi();
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("NOT_FOUND");
});
