import "server-only";

import type { User } from "@shared/types";
import { getCurrentUser } from "./auth/session";

/**
 * Shared authorization helpers for the Server Actions ported from the legacy
 * Express controllers. They encode the same rules those controllers used —
 * see the legacy core/security/requestAccess.ts — so behavior carries over.
 *
 * Gates follow the convention every already-migrated action uses: a page
 * permission (role_permissions.permission_key) plus, where the legacy route
 * had one, a role check. role_permissions.can_edit is NOT consulted because
 * the database initializer never backfills it, so most production roles
 * have can_edit=false everywhere; gating on it would lock everyone out.
 */
export interface AuthorizedUser extends User {
  /** Lowercased, trimmed role name. */
  roleKey: string;
}

export async function requireUser(): Promise<AuthorizedUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Your session has expired. Please log in again.");
  return { ...user, roleKey: user.role.trim().toLowerCase() };
}

export function hasAnyPermission(user: User, keys: readonly string[]): boolean {
  return keys.some((key) => user.permissions.includes(key));
}

export function requirePermission(user: AuthorizedUser, keys: readonly string[]): void {
  if (user.roleKey === "admin") return;
  if (!hasAnyPermission(user, keys)) throw new Error("Permission denied.");
}

export function requireRole(user: AuthorizedUser, roles: readonly string[]): void {
  if (!roles.includes(user.roleKey)) throw new Error("Permission denied.");
}

/**
 * Roles that see every department. Framed as an exclusion list so an unknown
 * (custom) role defaults to department-scoped — the safe choice. Mirrors the
 * legacy UNSCOPED_ROLES plus the newer cross-department reviewer roles.
 */
const UNSCOPED_ROLES = new Set([
  "custodian",
  "admin",
  "director",
  "purchaser",
  "ap_officer",
  "operations_manager",
]);

export function isDepartmentScoped(user: AuthorizedUser): boolean {
  return !UNSCOPED_ROLES.has(user.roleKey);
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

export function requireDepartmentAccess(user: AuthorizedUser, department: string): void {
  if (isDepartmentScoped(user) && !sameText(user.department, department)) {
    throw new Error("You do not have access to this request.");
  }
}

/** Created it, or is the named requester (a secretary can file on someone's behalf). */
export function isRequestOwner(
  user: AuthorizedUser,
  request: { created_by: string; requested_by: string | null }
): boolean {
  return request.created_by === user.id || sameText(request.requested_by, user.name);
}

/** Secretary/Supervisor/Manager — the roles that resolve the HOLD hand-off. */
export function isHoldResolver(user: AuthorizedUser): boolean {
  return ["secretary", "supervisor", "manager"].includes(user.roleKey);
}

export function assertId(id: unknown, label = "ID"): number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    throw new Error(`Invalid ${label}.`);
  }
  return id;
}

export function asRecord(value: unknown, label = "request"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} details.`);
  }
  return value as Record<string, unknown>;
}

/** undefined = not sent (leave as is), null = clear. */
export function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  label = key.replaceAll("_", " ")
): string | null | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
  return trimmed;
}

export function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  label = key.replaceAll("_", " ")
): string {
  const value = optionalString(input, key, maxLength, label);
  if (!value) throw new Error(`${label.charAt(0).toUpperCase()}${label.slice(1)} is required.`);
  return value;
}

export function requiredReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim()) throw new Error("A reason is required.");
  if (reason.trim().length > 500) throw new Error("The reason must be at most 500 characters.");
  return reason.trim();
}

export function optionalIsoDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  return value;
}

/** Non-negative money amount with at most 2 decimals, returned as the NUMERIC string Postgres stores. */
export function moneyString(value: unknown, label: string, { allowZero = true } = {}): string {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  if (number < 0 || (!allowZero && number === 0)) {
    throw new Error(`${label} must be ${allowZero ? "zero or more" : "greater than zero"}.`);
  }
  if (number > 9_999_999_999.99) throw new Error(`${label} is too large.`);
  if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) {
    throw new Error(`${label} can have at most 2 decimal places.`);
  }
  return number.toFixed(2);
}
