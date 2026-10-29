import { getEffectiveRequestStatus } from "@/lib/utils/status";

describe("getEffectiveRequestStatus", () => {
  it("shows a Supervisor/Manager decline even though the overall status is still pending", () => {
    expect(getEffectiveRequestStatus({ status: "pending", supervisor_status: "rejected", custodian_status: "pending" })).toBe("rejected");
  });

  it("shows a Custodian decline", () => {
    expect(getEffectiveRequestStatus({ status: "pending", supervisor_status: "approved", custodian_status: "rejected" })).toBe("rejected");
  });

  it("otherwise keeps the overall status", () => {
    expect(getEffectiveRequestStatus({ status: "pending", supervisor_status: "pending", custodian_status: "pending" })).toBe("pending");
    expect(getEffectiveRequestStatus({ status: "approved", supervisor_status: "approved", custodian_status: "approved" })).toBe("approved");
  });
});
