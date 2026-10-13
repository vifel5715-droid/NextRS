import "server-only";

import { cookies } from "next/headers";
import type { User } from "@/types";
import { readSessionSecret, signSessionToken, verifySessionToken } from "@/lib/session-token";
import { findSessionUser } from "@/server/repositories/user-repository";

/**
 * Session cookie handling. The cookie holds a signed token (lib/session-token.ts)
 * naming the user and their session_version; the user, role and permissions
 * are re-read from the database on every request, so role changes and
 * deletions take effect immediately and a bumped session_version (logout,
 * password change) revokes the token.
 */
const SESSION_COOKIE = "request_system_session";
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

export async function setSessionCookie(userId: string, sessionVersion: number): Promise<void> {
  const token = signSessionToken(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS, ver: sessionVersion },
    readSessionSecret()
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = verifySessionToken(token, readSessionSecret());
  if (!session) return null;

  const record = await findSessionUser(session.sub);
  if (!record || record.sessionVersion !== session.ver) return null;

  const { sessionVersion: _sessionVersion, ...user } = record;
  return user;
}
