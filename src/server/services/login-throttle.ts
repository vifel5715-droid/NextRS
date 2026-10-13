import "server-only";

import { and, count, eq, gt, lt, min, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { failedLoginAttempts } from "@/db/schema";
import { databaseErrorCode } from "@/lib/action-result";
import { logger } from "@/lib/logger";
import {
  evaluateLoginThrottle,
  LOGIN_WINDOW_SECONDS,
  type FailureWindow,
  type ThrottleDecision,
} from "@/server/policies/login-throttle-policy";

const UNDEFINED_TABLE = "42P01";

/**
 * Until `npm run db:setup` has created failed_login_attempts, throttling is
 * skipped (and logged loudly) rather than locking every user out of a freshly
 * deployed build. Any other database error propagates.
 */
async function tolerateMissingTable<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (databaseErrorCode(error) !== UNDEFINED_TABLE) throw error;
    logger.error("Login throttling is disabled: run `npm run db:setup` to create failed_login_attempts", { error });
    return fallback;
  }
}

const windowStart = () => sql`now() - make_interval(secs => ${LOGIN_WINDOW_SECONDS})`;

async function failuresWhere(condition: ReturnType<typeof eq>): Promise<FailureWindow> {
  const [row] = await getDb()
    .select({ count: count(), oldestAt: min(failedLoginAttempts.attempted_at) })
    .from(failedLoginAttempts)
    .where(and(condition, gt(failedLoginAttempts.attempted_at, windowStart())));
  return { count: row?.count ?? 0, oldestAt: row?.oldestAt ? new Date(row.oldestAt) : null };
}

export async function checkLoginThrottle(usernameKey: string, ip: string | null): Promise<ThrottleDecision> {
  return tolerateMissingTable<ThrottleDecision>({ limited: false }, async () => {
    const byUsername = await failuresWhere(eq(failedLoginAttempts.username_key, usernameKey));
    const byIp = ip
      ? await failuresWhere(eq(failedLoginAttempts.ip_address, ip))
      : { count: 0, oldestAt: null };
    return evaluateLoginThrottle(byUsername, byIp);
  });
}

export async function recordLoginFailure(usernameKey: string, ip: string | null): Promise<void> {
  await tolerateMissingTable(undefined, async () => {
    const db = getDb();
    await db.insert(failedLoginAttempts).values({ username_key: usernameKey, ip_address: ip });
    // Opportunistic pruning keeps the table small without a scheduled job.
    await db
      .delete(failedLoginAttempts)
      .where(lt(failedLoginAttempts.attempted_at, sql`now() - interval '1 day'`));
  });
}

export async function clearLoginFailures(usernameKey: string): Promise<void> {
  await tolerateMissingTable(undefined, async () => {
    await getDb().delete(failedLoginAttempts).where(eq(failedLoginAttempts.username_key, usernameKey));
  });
}
