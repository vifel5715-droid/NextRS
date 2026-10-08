import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import type { User } from "@shared/types";
import { getDb } from "../db";
import { rolePermissions, roles, users } from "../db/schema";

const SESSION_COOKIE = "request_system_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function verifySessionToken(token: string): SessionPayload | null {
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra !== undefined) return null;

  const expectedSignature = Buffer.from(signature(payload), "base64url");
  const actualSignature = Buffer.from(providedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sub" in parsed) ||
    typeof parsed.sub !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.sub) ||
    !("exp" in parsed) ||
    typeof parsed.exp !== "number" ||
    !Number.isSafeInteger(parsed.exp) ||
    parsed.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return { sub: parsed.sub, exp: parsed.exp };
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
    } satisfies SessionPayload)
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(userId), {
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

  const session = verifySessionToken(token);
  if (!session) return null;

  const db = getDb();
  const [record] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.username,
      role: users.role,
      department: users.department,
    })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);

  if (!record) return null;

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${record.role})`)
    .limit(1);

  if (!role) {
    return { ...record, permissions: [], editPermissions: [] };
  }

  const grants = await db
    .select({
      key: rolePermissions.permission_key,
      canEdit: rolePermissions.can_edit,
    })
    .from(rolePermissions)
    .where(eq(rolePermissions.role_id, role.id));

  return {
    ...record,
    permissions: grants.map((grant) => grant.key),
    editPermissions: grants.filter((grant) => grant.canEdit).map((grant) => grant.key),
  };
}
