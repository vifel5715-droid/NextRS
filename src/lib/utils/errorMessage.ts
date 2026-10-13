/**
 * Pulls a human-readable message out of an unknown thrown value.
 *
 * Typing the catch as `unknown` is the honest signature — a throw really can
 * be anything — and narrowing it here means each caller stops reaching
 * blindly into a shape that may not exist. Server Action failures arrive as
 * plain Errors (see lib/utils/actionResult.ts), so their message is used as is.
 */
export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string' && error) return error;
  return fallback;
};
