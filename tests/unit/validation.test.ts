import { ValidationError } from "@/lib/errors";
import { assertId, moneyString, optionalIsoDate, optionalString, requiredReason, requiredString } from "@/lib/validation";
import { clientIpFrom } from "@/lib/request-context";
import { allMachineCodesValid, getMachineCodeError, isMachineCodeEnabled } from "@/lib/utils/machineCodeValidation";
import { loginSchema } from "@/features/auth/schemas/login";
import { requestIdParamSchema } from "@/features/requests/schemas/request-query";

describe("server input validation", () => {
  it("accepts only positive safe integer ids", () => {
    expect(assertId(5)).toBe(5);
    for (const bad of [0, -1, 1.5, "5", Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(() => assertId(bad)).toThrow(ValidationError);
    }
  });

  it("distinguishes not-sent, cleared and set strings", () => {
    expect(optionalString({}, "remarks", 10)).toBeUndefined();
    expect(optionalString({ remarks: null }, "remarks", 10)).toBeNull();
    expect(optionalString({ remarks: "  hi  " }, "remarks", 10)).toBe("hi");
    expect(() => optionalString({ remarks: "x".repeat(11) }, "remarks", 10)).toThrow("remarks must be at most 10 characters.");
    expect(() => requiredString({ purpose: " " }, "purpose", 10)).toThrow("Purpose is required.");
  });

  it("requires a bounded reason", () => {
    expect(requiredReason("  wrong item ")).toBe("wrong item");
    expect(() => requiredReason("")).toThrow("A reason is required.");
    expect(() => requiredReason("x".repeat(501))).toThrow(/at most 500/);
  });

  it("validates ISO dates", () => {
    expect(optionalIsoDate("2026-10-13", "Date needed")).toBe("2026-10-13");
    expect(optionalIsoDate("", "Date needed")).toBeNull();
    expect(() => optionalIsoDate("13/10/2026", "Date needed")).toThrow(/YYYY-MM-DD/);
  });

  it("normalizes money to two decimals and rejects bad amounts", () => {
    expect(moneyString("12.5", "Amount")).toBe("12.50");
    expect(moneyString(0, "Amount")).toBe("0.00");
    expect(() => moneyString(0, "Amount", { allowZero: false })).toThrow("Amount must be greater than zero.");
    expect(() => moneyString(-1, "Amount")).toThrow(/zero or more/);
    expect(() => moneyString(1.005, "Amount")).toThrow(/2 decimal places/);
    expect(() => moneyString("abc", "Amount")).toThrow(/must be a number/);
  });
});

describe("Item Master: machine code validation", () => {
  const codes = new Set(["MC-001", "MC-002"]);

  it("requires a registered machine code, case-insensitively", () => {
    expect(getMachineCodeError("mc-001", codes)).toBeNull();
    expect(getMachineCodeError("", codes)).toBe("Machine Code is required.");
    expect(getMachineCodeError("MC-999", codes)).toBe("Invalid Machine Code. Record not found.");
    expect(allMachineCodesValid([{ machine_code: "MC-001" }, { machine_code: "MC-404" }], codes)).toBe(false);
  });

  it("only applies to Engineering", () => {
    expect(isMachineCodeEnabled(" engg ")).toBe(true);
    expect(isMachineCodeEnabled("HR")).toBe(false);
  });
});

describe("Zod request schemas", () => {
  it("trims usernames and bounds credential length", () => {
    expect(loginSchema.parse({ username: " jane ", password: "pw" })).toEqual({ username: "jane", password: "pw" });
    expect(loginSchema.safeParse({ username: "", password: "pw" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: "jane", password: "x".repeat(1025) }).success).toBe(false);
  });

  it("parses route ids strictly", () => {
    expect(requestIdParamSchema.parse("42")).toBe(42);
    for (const bad of ["0", "-3", "1.5", "abc", "99999999999"]) {
      expect(requestIdParamSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("client IP resolution", () => {
  const h = (entries: Record<string, string>) => new Headers(entries);

  it("prefers X-Real-IP", () => {
    expect(clientIpFrom(h({ "x-real-ip": "10.0.0.9", "x-forwarded-for": "1.1.1.1" }))).toBe("10.0.0.9");
  });

  it("trusts the right-most X-Forwarded-For hop, which the proxy appended", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("returns null without proxy headers", () => {
    expect(clientIpFrom(h({}))).toBeNull();
  });
});
