/**
 * Errors whose message is written for the end user and safe to show as is.
 *
 * Server code throws these (or a plain `Error`, the older validation style)
 * for expected failures. `toUserMessage` (lib/action-result.ts) passes their
 * message through; anything else — driver/ORM errors whose message can embed
 * SQL and bound parameters — is logged and replaced with a generic message.
 * Route Handlers use `status` to pick the HTTP status code.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Your session has expired. Please log in again.") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Permission denied.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      429,
      "RATE_LIMITED"
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
