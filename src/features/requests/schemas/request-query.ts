import { z } from "zod";

export const requestTypeSchema = z.enum(["item", "service"]);

export const requestListQuerySchema = z.object({
  type: requestTypeSchema.optional(),
  scope: z.enum(["all", "own"]).default("all"),
});

export const requestIdParamSchema = z.coerce.number().int().positive().max(2_147_483_647);
