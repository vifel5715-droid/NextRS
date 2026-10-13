/**
 * Input parsing helpers for Server Actions that take loosely-typed payloads
 * from the client. Each throws a ValidationError with a user-facing message.
 * New code should prefer a Zod schema (see the features schemas folders) — these keep
 * the existing actions' exact messages and semantics.
 */
import { ValidationError } from "@/lib/errors";

export function assertId(id: unknown, label = "ID"): number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError(`Invalid ${label}.`);
  }
  return id;
}

export function asRecord(value: unknown, label = "request"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`Invalid ${label} details.`);
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
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ValidationError(`${label} must be at most ${maxLength} characters.`);
  return trimmed;
}

export function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  label = key.replaceAll("_", " ")
): string {
  const value = optionalString(input, key, maxLength, label);
  if (!value) throw new ValidationError(`${label.charAt(0).toUpperCase()}${label.slice(1)} is required.`);
  return value;
}

export function requiredReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim()) throw new ValidationError("A reason is required.");
  if (reason.trim().length > 500) throw new ValidationError("The reason must be at most 500 characters.");
  return reason.trim();
}

export function optionalIsoDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  return value;
}

/** Non-negative money amount with at most 2 decimals, returned as the NUMERIC string Postgres stores. */
export function moneyString(value: unknown, label: string, { allowZero = true } = {}): string {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new ValidationError(`${label} must be a number.`);
  if (number < 0 || (!allowZero && number === 0)) {
    throw new ValidationError(`${label} must be ${allowZero ? "zero or more" : "greater than zero"}.`);
  }
  if (number > 9_999_999_999.99) throw new ValidationError(`${label} is too large.`);
  if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) {
    throw new ValidationError(`${label} can have at most 2 decimal places.`);
  }
  return number.toFixed(2);
}
