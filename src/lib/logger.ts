/**
 * ARCH: centralized server-side logger.
 *
 * One JSON line per event in production (easy to grep/ship from the host's
 * log stream), readable output in development. Two guarantees every call
 * site relies on:
 *
 *  - Context keys that look like secrets (password, token, cookie, hash,
 *    attachment bytes, ...) are replaced with "[REDACTED]" at any depth.
 *  - Errors are reduced to name/message/code/cause. Drizzle query errors
 *    embed the bound parameters in their message ("params: ..."), which can
 *    include password hashes or personal data, so that part is stripped.
 *
 * Client code uses lib/client-logger.ts (dev-only console output) instead.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|session|hash|attachment_data|credential/i;
const MAX_DEPTH = 4;
const isProduction = process.env.NODE_ENV === "production";

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SerializedError;
}

function sanitizeMessage(message: string): string {
  const at = message.toLowerCase().indexOf("params:");
  return at === -1 ? message : `${message.slice(0, at).trimEnd()} [params redacted]`;
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: typeof error === "string" ? sanitizeMessage(error) : "Unknown error" };
  }
  const code = (error as { code?: unknown }).code;
  const message = sanitizeMessage(error.message);
  const serialized: SerializedError = {
    name: error.name,
    message,
    ...(typeof code === "string" ? { code } : {}),
    // The stack starts with the original message, so it is sanitized too.
    ...(!isProduction && error.stack ? { stack: error.stack.replace(error.message, message) } : {}),
  };
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    serialized.cause = serializeError(error.cause, depth + 1);
  }
  return serialized;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ])
  );
}

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (level === "debug" && isProduction) return;
  const safeContext = context ? (redact(context) as Record<string, unknown>) : undefined;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (isProduction) {
    sink(JSON.stringify({ time: new Date().toISOString(), level, message, ...safeContext }));
  } else {
    sink(`[${level}] ${message}`, ...(safeContext ? [safeContext] : []));
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
