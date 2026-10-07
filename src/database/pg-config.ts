import type { PoolConfig } from "pg";

const LOCAL_HOST_RE = /(?:host\s*=\s*(localhost|127\.0\.0\.1)|postgres:\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1))/i;
const SSL_MODE_RE = /sslmode\s*=\s*(prefer|require|verify-ca)/i;

export function poolConfigFromConnectionString(connectionString: string): PoolConfig {
  const config: PoolConfig = { connectionString };

  if (SSL_MODE_RE.test(connectionString) && LOCAL_HOST_RE.test(connectionString)) {
    config.ssl = false;
  }

  return config;
}
