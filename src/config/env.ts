import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).refine(
    (value) => /^postgres(ql)?:\/\//i.test(value) || /(?:^|\s)host=/.test(value),
    "DATABASE_URL must be a PostgreSQL connection URL or connection string"
  ),
  INIT_DB_DEMO_PASSWORD: z.string().optional(),
  ADMIN_RESET_PASSWORD: z.string().optional(),
  LEGACY_UPLOADS_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);
