import { env } from "../src/lib/env";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  pool.on("error", (err) => {
    console.error("POOL ERROR EVENT:", err);
    console.error("POOL ERROR KEYS:", Object.keys(err));
    console.error("POOL ERROR PROPS:", Object.getOwnPropertyNames(err));
    try {
      console.error("POOL ERROR JSON:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    } catch (writeErr) {
      console.error("POOL ERROR JSON FAILED", writeErr);
    }
  });

  try {
    console.log("Using connection:", env.DATABASE_URL);
    const result = await pool.query("SELECT 1 AS ok");
    console.log("RESULT", result.rows);
  } catch (error) {
    console.error("QUERY ERROR:", error);
    console.error("QUERY ERROR KEYS:", Object.keys(error as object));
    console.error("QUERY ERROR PROPS:", Object.getOwnPropertyNames(error as object));
    try {
      console.error("QUERY ERROR JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    } catch (writeErr) {
      console.error("QUERY ERROR JSON FAILED", writeErr);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FATAL ERROR:", error);
});
