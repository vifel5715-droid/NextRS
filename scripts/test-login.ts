/**
 * ARCH: Local sanity check (run via `npm run test-login`).
 * Verifies argon2 hash/verify works on this machine. No DB access.
 */
import { hashPassword, verifyPassword } from "../src/lib/password";

async function testAdminPassword() {
  // Not a real credential — an arbitrary fixture string, chosen only so this
  // self-check never coincides with an actual account password.
  const testPassword = "argon2-self-check-fixture";
  // A reference hash produced earlier from the fixture string above; used
  // only to confirm the verifier still recognises the argon2id format the
  // app produces.
  const hashedPassword =
    "$argon2id$v=19$m=65536,t=3,p=4$Ik2RwFlPh4w5A4/h3soGRA$Ls/WMdygJPffEgJQ9jYPWnVd/nCWOHFHkUJyq3zxqXQ";

  console.log("Testing argon2 hash/verify...");
  const isValid = await verifyPassword(hashedPassword, testPassword);
  console.log("Stored hash verifies:", isValid);

  const newHash = await hashPassword(testPassword);
  const newValid = await verifyPassword(newHash, testPassword);
  console.log("Fresh hash verifies:", newValid);
}

testAdminPassword().catch(console.error);
