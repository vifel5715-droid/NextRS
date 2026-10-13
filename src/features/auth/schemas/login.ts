import { z } from "zod";

/** Same bounds the login action has always enforced. */
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export type LoginInput = z.infer<typeof loginSchema>;
