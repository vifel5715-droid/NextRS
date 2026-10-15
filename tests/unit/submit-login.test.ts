/**
 * Login form submit: the Sign In button's loading/disabled state and the
 * guard against duplicate submissions (clicks and Enter both call submit).
 */
import type { LoginResult } from "@/features/auth/actions/auth";
import type { User } from "@/types";
import { submitLogin, type SubmitLoginDeps } from "@/features/auth/hooks/submitLogin";

const user: User = {
  id: "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c",
  name: "JOEL",
  email: "joel",
  role: "staff",
  department: "HR",
  permissions: ["create_request"],
  editPermissions: [],
};

/** A login request the test settles by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(loginAction: SubmitLoginDeps["loginAction"]) {
  const loadingHistory: boolean[] = [];
  const state = { loading: false, error: "" };
  const deps = {
    inFlight: { current: false },
    loginAction: jest.fn(loginAction),
    setLoading: jest.fn((value: boolean) => {
      state.loading = value;
      loadingHistory.push(value);
    }),
    setError: jest.fn((message: string) => {
      state.error = message;
    }),
    onSuccess: jest.fn(),
    onNetworkError: jest.fn(),
  };
  return { deps, state, loadingHistory };
}

const form = { username: "joel", password: "secret", rememberMe: false };

describe("submitLogin", () => {
  it("disables the button immediately, before the request resolves", async () => {
    const request = deferred<LoginResult>();
    const { deps, state } = setup(() => request.promise);
    const pending = submitLogin(form, deps);
    expect(state.loading).toBe(true);
    expect(deps.inFlight.current).toBe(true);
    request.resolve({ success: false, error: "INVALID_CREDENTIALS" });
    await pending;
  });

  it("ignores repeated submits (clicks or Enter) while one is in flight", async () => {
    const request = deferred<LoginResult>();
    const { deps } = setup(() => request.promise);
    const first = submitLogin(form, deps);
    await submitLogin(form, deps);
    await submitLogin(form, deps);
    expect(deps.loginAction).toHaveBeenCalledTimes(1);
    request.resolve({ success: false, error: "INVALID_CREDENTIALS" });
    await first;
  });

  it("re-enables the button after invalid credentials and allows a retry", async () => {
    const { deps, state, loadingHistory } = setup(async () => ({ success: false, error: "INVALID_CREDENTIALS" }));
    await submitLogin(form, deps);
    expect(state.error).toBe("Invalid username or password.");
    expect(loadingHistory).toEqual([true, false]);
    expect(deps.inFlight.current).toBe(false);

    await submitLogin(form, deps);
    expect(deps.loginAction).toHaveBeenCalledTimes(2);
  });

  it.each<[string, LoginResult, string]>([
    ["server unavailable", { success: false, error: "UNAVAILABLE" }, "Sign-in is temporarily unavailable. Please try again in a few minutes."],
    ["throttled", { success: false, error: "RATE_LIMITED", message: "Too many attempts. Try again in 2 minutes." }, "Too many attempts. Try again in 2 minutes."],
  ])("re-enables the button when %s", async (_case, result, message) => {
    const { deps, state } = setup(async () => result);
    await submitLogin(form, deps);
    expect(state.error).toBe(message);
    expect(state.loading).toBe(false);
    expect(deps.inFlight.current).toBe(false);
  });

  it("re-enables the button after a network failure", async () => {
    const { deps, state } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await submitLogin(form, deps);
    expect(state.error).toBe("Unable to reach the server. Please check your connection and try again.");
    expect(state.loading).toBe(false);
    expect(deps.inFlight.current).toBe(false);
    expect(deps.onNetworkError).toHaveBeenCalled();
  });

  it("keeps the button locked through the redirect on success", async () => {
    const { deps, state, loadingHistory } = setup(async () => ({ success: true, user }));
    await submitLogin(form, deps);
    expect(deps.onSuccess).toHaveBeenCalledWith(user);
    expect(state.loading).toBe(true);
    expect(loadingHistory).toEqual([true]);
    expect(state.error).toBe("");
    // A stray second submit during navigation does nothing.
    await submitLogin(form, deps);
    expect(deps.loginAction).toHaveBeenCalledTimes(1);
  });

  it("passes Remember me through unchanged", async () => {
    const { deps } = setup(async () => ({ success: false, error: "INVALID_CREDENTIALS" }));
    await submitLogin({ ...form, rememberMe: true }, deps);
    expect(deps.loginAction).toHaveBeenCalledWith("joel", "secret", true);
  });

  it.each([
    ["an empty username", { ...form, username: "" }],
    ["a whitespace-only username", { ...form, username: "   " }],
    ["an empty password", { ...form, password: "" }],
  ])("rejects %s without sending a request or disabling the button", async (_case, input) => {
    const { deps, state } = setup(async () => ({ success: true, user }));
    await submitLogin(input, deps);
    expect(deps.loginAction).not.toHaveBeenCalled();
    expect(deps.setLoading).not.toHaveBeenCalled();
    expect(state.error).toBe("Enter your username and password.");
  });
});
