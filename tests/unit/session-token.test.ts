import {
  readSessionSecret,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/session-token";

const SECRET = "x".repeat(32);
const USER_ID = "4f0c7c1e-8a3b-4b9e-9d2a-0c1e2f3a4b5c";
const NOW = 1_800_000_000;

const payload = (overrides: Partial<SessionPayload> = {}): SessionPayload => ({
  sub: USER_ID,
  exp: NOW + 3600,
  ver: 0,
  ...overrides,
});

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = signSessionToken(payload({ ver: 3 }), SECRET);
    expect(verifySessionToken(token, SECRET, NOW)).toEqual(payload({ ver: 3 }));
  });

  it("rejects a token signed with another secret", () => {
    const token = signSessionToken(payload(), SECRET);
    expect(verifySessionToken(token, "y".repeat(32), NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signSessionToken(payload(), SECRET);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ sub: "00000000-0000-4000-8000-000000000000" }))).toString("base64url");
    expect(verifySessionToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signSessionToken(payload({ exp: NOW }), SECRET);
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", "only-one-part."])("rejects malformed token %p", (token) => {
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it("rejects a non-UUID subject and negative versions", () => {
    expect(verifySessionToken(signSessionToken(payload({ sub: "admin" }), SECRET), SECRET, NOW)).toBeNull();
    expect(verifySessionToken(signSessionToken(payload({ ver: -1 }), SECRET), SECRET, NOW)).toBeNull();
  });

  it("reads legacy tokens without a version as version 0", () => {
    const legacy = signSessionToken({ sub: USER_ID, exp: NOW + 60 } as SessionPayload, SECRET);
    expect(verifySessionToken(legacy, SECRET, NOW)?.ver).toBe(0);
  });

  it("requires a session secret of at least 32 bytes", () => {
    expect(() => readSessionSecret(undefined)).toThrow(/at least 32 bytes/);
    expect(() => readSessionSecret("short")).toThrow(/at least 32 bytes/);
    expect(readSessionSecret(SECRET)).toBe(SECRET);
  });
});
