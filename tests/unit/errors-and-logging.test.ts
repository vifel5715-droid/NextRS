import { toUserMessage, databaseErrorCode } from "@/lib/action-result";
import { ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { redact, serializeError } from "@/lib/logger";

describe("toUserMessage", () => {
  it("passes typed application errors through", () => {
    expect(toUserMessage(new ForbiddenError())).toBe("Permission denied.");
    expect(toUserMessage(new ValidationError("Quantity must be at least 1."))).toBe("Quantity must be at least 1.");
    expect(toUserMessage(new NotFoundError("Request not found."))).toBe("Request not found.");
  });

  it("passes plain Error messages through (older validation style)", () => {
    expect(toUserMessage(new Error("A reason is required."))).toBe("A reason is required.");
  });

  it("hides driver errors, which can embed SQL and parameters", () => {
    class DatabaseError extends Error {
      code = "42703";
    }
    const error = new DatabaseError('column "secret_col" does not exist');
    expect(toUserMessage(error)).toBe("An unexpected server error occurred. Please try again.");
  });

  it.each([
    ["23505", "A record with the same unique value already exists."],
    ["23503", "This record references data that no longer exists."],
    ["40001", "The record was changed by someone else at the same time. Please try again."],
    ["40P01", "The record was changed by someone else at the same time. Please try again."],
  ])("maps SQLSTATE %s to a safe message, even when wrapped", (code, message) => {
    const pgError = Object.assign(new TypeError("raw driver text"), { code });
    const wrapped = new TypeError("Failed query: insert ...", { cause: pgError });
    expect(databaseErrorCode(wrapped)).toBe(code);
    expect(toUserMessage(wrapped)).toBe(message);
  });

  it("formats the rate-limit wait in minutes", () => {
    expect(new RateLimitError(61).message).toBe("Too many failed login attempts. Try again in 2 minutes.");
    expect(new RateLimitError(30).message).toBe("Too many failed login attempts. Try again in 1 minute.");
    expect(new RateLimitError(30).status).toBe(429);
  });
});

describe("logger redaction", () => {
  it("redacts secret-looking keys at any depth", () => {
    expect(
      redact({
        username: "jane",
        password: "hunter2",
        nested: { password_hash: "$argon2id$...", sessionToken: "abc", cookie: "x", ok: 1 },
        list: [{ Authorization: "Bearer y" }],
      })
    ).toEqual({
      username: "jane",
      password: "[REDACTED]",
      nested: { password_hash: "[REDACTED]", sessionToken: "[REDACTED]", cookie: "[REDACTED]", ok: 1 },
      list: [{ Authorization: "[REDACTED]" }],
    });
  });

  it("summarizes buffers instead of logging their bytes", () => {
    expect(redact({ file: Buffer.from("abc") })).toEqual({ file: "[Buffer 3 bytes]" });
  });

  it("strips bound parameters from Drizzle query errors", () => {
    const error = new Error('Failed query: insert into "users" values ($1, $2)\nparams: jane,$argon2id$v=19$secret');
    const serialized = serializeError(error);
    expect(serialized.message).toBe('Failed query: insert into "users" values ($1, $2) [params redacted]');
    expect(JSON.stringify(serialized)).not.toContain("argon2id");
  });

  it("keeps the SQLSTATE and cause chain", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });
    const serialized = serializeError(new Error("Failed query", { cause }));
    expect(serialized.cause).toMatchObject({ message: "duplicate key", code: "23505" });
  });
});
