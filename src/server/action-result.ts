import "server-only";

/**
 * ARCH: Server Action result envelope.
 *
 * Next.js deliberately redacts the message of any error thrown out of a
 * Server Action in production builds — the client only ever sees "Minified
 * React error #441" (the RSC client's generic resolveErrorProd). Every
 * user-facing validation/permission message ("Permission denied.", "Quantity
 * must be...") was therefore invisible in production. Mutation actions now
 * catch and return their failure as data instead, and the client unwraps it
 * back into an ordinary Error (see shared/utils/actionResult.ts) so existing
 * `catch (error) { getErrorMessage(error) }` call sites keep working.
 *
 * Only plain `Error` messages (the `throw new Error("...")` validation style
 * used throughout server/actions) are passed through. Driver/ORM errors
 * (pg DatabaseError, DrizzleQueryError — both Error subclasses whose message
 * can embed SQL text and bound parameters) are logged server-side and
 * replaced with a generic message, except for the few constraint violations
 * that have a safe, useful meaning to the user.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "An unexpected server error occurred. Please try again.";

function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.constructor === Error && error.message) {
    return error.message;
  }
  switch (databaseErrorCode(error)) {
    case "23505":
      return "A record with the same unique value already exists.";
    case "23503":
      return "This record references data that no longer exists.";
    case "40001":
    case "40P01":
      return "The record was changed by someone else at the same time. Please try again.";
    default:
      return GENERIC_ERROR;
  }
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const message = toUserMessage(error);
    if (message === GENERIC_ERROR || databaseErrorCode(error)) {
      console.error("Server action failed:", error);
    }
    return { ok: false, error: message };
  }
}
