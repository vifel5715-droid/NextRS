import axios from 'axios';

/**
 * Pulls a human-readable message out of an unknown thrown value.
 *
 * Replaces the `catch (error: any)` / `error.response?.data?.error || error.message`
 * pattern that was repeated across every hook. Typing the catch as `unknown` is
 * the honest signature — a throw really can be anything — and narrowing it here
 * means each caller stops reaching blindly into a response shape that may not
 * exist.
 *
 * The API's error middleware responds with `{ error, message }`, so both keys
 * are checked before falling back to the transport-level message.
 */
export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown; message?: unknown } | undefined;
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.message === 'string') return data.message;
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string' && error) return error;
  return fallback;
};

/** HTTP status of a failed request, when the error came from one. */
export const getErrorStatus = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : undefined;

type ValidationIssue = { path?: unknown; message?: unknown };

/**
 * Formats a zod validation failure, which the API returns as
 * `{ error: [{ path, message }, ...] }` rather than a plain string.
 * Returns undefined when the error is not of that shape, so callers can fall
 * through to getErrorMessage.
 */
export const getValidationMessage = (error: unknown): string | undefined => {
  if (!axios.isAxiosError(error)) return undefined;
  const data = error.response?.data as { error?: unknown } | undefined;
  if (!Array.isArray(data?.error)) return undefined;

  return (data.error as ValidationIssue[])
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? '');
      return `${path}: ${String(issue.message ?? '')}`;
    })
    .join('\n');
};
