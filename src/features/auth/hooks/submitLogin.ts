import type { LoginResult } from "@/features/auth/actions/auth";
import type { User } from "@/types";

type LoginFailure = Exclude<LoginResult, { success: true }>;

export function loginErrorMessage(response: LoginFailure): string {
  switch (response.error) {
    case "RATE_LIMITED":
      return response.message;
    case "INVALID_CREDENTIALS":
      return "Invalid username or password.";
    case "UNAVAILABLE":
      return "Sign-in is temporarily unavailable. Please try again in a few minutes.";
    default:
      return "Enter a valid username and password.";
  }
}

export interface SubmitLoginDeps {
  /** Synchronous single-flight flag — blocks a second submit before React re-renders. */
  inFlight: { current: boolean };
  loginAction: (username: string, password: string, rememberMe: boolean) => Promise<LoginResult>;
  setLoading: (loading: boolean) => void;
  setError: (message: string) => void;
  onSuccess: (user: User) => void;
  onNetworkError?: (error: unknown) => void;
}

/**
 * The login form's submit, outside React so it can be unit tested. Clicks
 * and Enter both arrive here, so the in-flight flag covers both paths, on top
 * of the button's `disabled`. Validation failures never start a request; any
 * failure re-enables the form; a success keeps it locked through the
 * redirect so the button can't flash clickable while the dashboard loads.
 */
export async function submitLogin(
  form: { username: string; password: string; rememberMe: boolean },
  deps: SubmitLoginDeps
): Promise<void> {
  if (deps.inFlight.current) return;

  // Same rule the server applies (loginSchema).
  if (!form.username.trim() || !form.password) {
    deps.setError("Enter your username and password.");
    return;
  }

  deps.inFlight.current = true;
  deps.setError("");
  deps.setLoading(true);
  let signedIn = false;

  try {
    const response = await deps.loginAction(form.username, form.password, form.rememberMe);
    if (!response.success) {
      deps.setError(loginErrorMessage(response));
      return;
    }
    signedIn = true;
    deps.onSuccess(response.user);
  } catch (error: unknown) {
    // Credential, throttling and server failures come back as data above;
    // reaching here means the request itself never completed.
    deps.onNetworkError?.(error);
    deps.setError("Unable to reach the server. Please check your connection and try again.");
  } finally {
    if (!signedIn) {
      deps.inFlight.current = false;
      deps.setLoading(false);
    }
  }
}
