/**
 * Client half of server/action-result.ts — Server Actions return their
 * failure as data (Next.js redacts thrown messages in production), and this
 * turns it back into a normal thrown Error so callers keep using
 * try/catch + getErrorMessage unchanged.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result || typeof result !== "object" || !("ok" in result)) {
    throw new Error("The server returned an unexpected response.");
  }
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** Adapts a result-returning Server Action into one that throws on failure. */
export function throwOnError<A extends unknown[], T>(
  action: (...args: A) => Promise<ActionResult<T>>
): (...args: A) => Promise<T> {
  return (...args: A) => action(...args).then(unwrapAction);
}

/** Same as unwrapAction, shaped like the old axios response ({ data }) that api.ts callers read. */
export async function asResponse<T>(promise: Promise<ActionResult<T>>): Promise<{ data: T }> {
  return { data: unwrapAction(await promise) };
}
