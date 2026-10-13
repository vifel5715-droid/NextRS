import {
  evaluateLoginThrottle,
  LOGIN_WINDOW_SECONDS,
  MAX_FAILURES_PER_IP,
  MAX_FAILURES_PER_USERNAME,
  usernameKey,
} from "@/server/policies/login-throttle-policy";

const NOW = new Date("2026-10-13T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const none = { count: 0, oldestAt: null };

describe("login throttle policy", () => {
  it("allows sign-in below both limits", () => {
    expect(evaluateLoginThrottle({ count: MAX_FAILURES_PER_USERNAME - 1, oldestAt: minutesAgo(1) }, none, NOW)).toEqual({
      limited: false,
    });
  });

  it("locks a username at the failure limit until the oldest failure leaves the window", () => {
    const result = evaluateLoginThrottle({ count: MAX_FAILURES_PER_USERNAME, oldestAt: minutesAgo(5) }, none, NOW);
    expect(result).toEqual({ limited: true, retryAfterSeconds: LOGIN_WINDOW_SECONDS - 5 * 60 });
  });

  it("limits an IP spraying many usernames", () => {
    const result = evaluateLoginThrottle(none, { count: MAX_FAILURES_PER_IP, oldestAt: minutesAgo(14) }, NOW);
    expect(result).toEqual({ limited: true, retryAfterSeconds: 60 });
  });

  it("reports the longer wait when both limits are hit", () => {
    const result = evaluateLoginThrottle(
      { count: MAX_FAILURES_PER_USERNAME, oldestAt: minutesAgo(1) },
      { count: MAX_FAILURES_PER_IP, oldestAt: minutesAgo(10) },
      NOW
    );
    expect(result).toEqual({ limited: true, retryAfterSeconds: LOGIN_WINDOW_SECONDS - 60 });
  });

  it("never asks the client to wait less than a second", () => {
    const result = evaluateLoginThrottle({ count: MAX_FAILURES_PER_USERNAME, oldestAt: minutesAgo(15) }, none, NOW);
    expect(result).toEqual({ limited: true, retryAfterSeconds: 1 });
  });

  it("normalizes usernames the way sign-in looks them up", () => {
    expect(usernameKey("  Admin ")).toBe("admin");
    expect(usernameKey("a".repeat(400))).toHaveLength(254);
  });
});
