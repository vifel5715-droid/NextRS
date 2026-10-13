/**
 * Brute-force limits for sign-in. Pure so the thresholds are unit tested.
 *
 * Per username: stops online password guessing against one account. Per IP:
 * stops one source spraying many usernames. Only failures count, and a
 * successful sign-in clears the username's failures. The trade-off of a
 * per-username limit is that someone who knows a username can lock it for one
 * window by failing on purpose — bounded to LOGIN_WINDOW_SECONDS.
 */
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_USERNAME = 5;
export const MAX_FAILURES_PER_IP = 30;

export interface FailureWindow {
  count: number;
  /** Oldest failure still inside the window, or null when count is 0. */
  oldestAt: Date | null;
}

export type ThrottleDecision = { limited: false } | { limited: true; retryAfterSeconds: number };

function retryAfter(window: FailureWindow, now: Date): number {
  if (!window.oldestAt) return LOGIN_WINDOW_SECONDS;
  const elapsed = Math.floor((now.getTime() - window.oldestAt.getTime()) / 1000);
  return Math.max(1, LOGIN_WINDOW_SECONDS - elapsed);
}

export function evaluateLoginThrottle(
  byUsername: FailureWindow,
  byIp: FailureWindow,
  now: Date = new Date()
): ThrottleDecision {
  const waits: number[] = [];
  if (byUsername.count >= MAX_FAILURES_PER_USERNAME) waits.push(retryAfter(byUsername, now));
  if (byIp.count >= MAX_FAILURES_PER_IP) waits.push(retryAfter(byIp, now));
  return waits.length ? { limited: true, retryAfterSeconds: Math.max(...waits) } : { limited: false };
}

/** Case/whitespace-insensitive key, matching how sign-in looks usernames up. */
export function usernameKey(username: string): string {
  return username.trim().toLowerCase().slice(0, 254);
}
