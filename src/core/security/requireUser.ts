/**
 * ARCH: Authenticated-user accessor.
 *
 * Routes always mount `authMiddleware` before these controllers, which sets
 * req.user. TS can't see that guarantee (Express typing is route-order-blind),
 * so without this helper every controller would need `req.user!` assertions or
 * null-guards that can never fire. This centralizes the assumption: it returns
 * the typed user, or throws ApiError(401) if a controller somehow runs without
 * auth middleware in front of it — turning a silent misuse into a loud failure.
 */
import type { Request } from "express";
import { ApiError } from "../errors/ApiError.js";
import type { JwtPayload } from "../../shared/types/jwt.js";

export function requireUser(req: Request): JwtPayload {
  if (!req.user) {
    throw ApiError.unauthorized("Authenticated user is missing on the request");
  }
  return req.user;
}
