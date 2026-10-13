import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ForbiddenError, RateLimitError } from "@/lib/errors";
import { toUserMessage } from "@/lib/action-result";
import { logger } from "@/lib/logger";

/**
 * ARCH: Route Handler conventions.
 *
 * Every JSON error has one shape: `{ error: { code, message } }`. AppErrors
 * map to their own status; Zod failures to 400; plain `Error`s (the older
 * validation style) to 400 with their message; anything else is logged and
 * returned as a generic 500 — internal messages and stack traces never reach
 * the client.
 */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function apiError(status: number, code: string, message: string, init?: ResponseInit): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { ...init, status });
}

export function handleApiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof RateLimitError) {
    return apiError(error.status, error.code, error.message, {
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    });
  }
  if (error instanceof AppError) return apiError(error.status, error.code, error.message);
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    return apiError(400, "VALIDATION_ERROR", message);
  }
  const message = toUserMessage(error);
  if (error instanceof Error && error.constructor === Error) return apiError(400, "BAD_REQUEST", message);
  logger.error("Route handler failed", { error });
  return apiError(500, "INTERNAL_ERROR", message);
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

export function withApiHandler<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

/**
 * CSRF guard for cookie-authenticated, state-changing Route Handlers.
 * (Server Actions get this check from Next.js itself.) Browsers always send
 * Origin on cross-site POSTs; non-browser clients usually send none, and
 * carry no ambient cookies for an attacker to ride on, so a missing Origin
 * is allowed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Cross-origin request rejected.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Cross-origin request rejected.");
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
