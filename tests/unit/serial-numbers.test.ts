import { lockSerialSequence, nextSerial } from "@/server/services/serial-numbers";

describe("request serial numbers", () => {
  it("starts each sequence at 000001", () => {
    expect(nextSerial("IRS-2026-", [])).toBe("IRS-2026-000001");
  });

  it("continues from the highest existing number, not the count", () => {
    expect(nextSerial("RMB-2026-", ["RMB-2026-000001", "RMB-2026-000007", "RMB-2026-000003"])).toBe("RMB-2026-000008");
  });

  it("never reuses a gap left by a deleted request", () => {
    expect(nextSerial("SRS-2026-", ["SRS-2026-000001", "SRS-2026-000004"])).toBe("SRS-2026-000005");
  });

  it("ignores null and malformed serials", () => {
    expect(nextSerial("ADJ-2026-", [null, undefined, "ADJ-2026-", "garbage", "ADJ-2026-000002"])).toBe("ADJ-2026-000003");
  });

  it("counts legacy URG-00 serials in the urgent sequence", () => {
    expect(nextSerial("URG-2026-", ["URG-00-2026-000009", "URG-2026-000004"])).toBe("URG-2026-000010");
  });

  it("grows past six digits instead of wrapping", () => {
    expect(nextSerial("PC-2026-", ["PC-2026-999999"])).toBe("PC-2026-1000000");
  });

  it("takes a transaction-scoped advisory lock for the sequence", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    await lockSerialSequence({ execute }, "item-request-serial-2026");
    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0][0] as { queryChunks: unknown[] };
    expect(JSON.stringify(query.queryChunks)).toContain("pg_advisory_xact_lock");
    expect(query.queryChunks).toContain("item-request-serial-2026");
  });
});
