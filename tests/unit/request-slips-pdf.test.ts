/**
 * Summary Requests "Download Printouts (PDF)": one slip page per request, for
 * every request type, saved as a single PDF.
 */
import type { jsPDF as JsPdf } from "jspdf";

let saved: { name: string; pages: number; text: string } | null = null;

// jsPDF attaches `save` per instance, so swap it on a subclass instead of spying the prototype.
jest.mock("jspdf", () => {
  const actual = jest.requireActual("jspdf");
  class CapturingPdf extends actual.jsPDF {
    constructor(...args: unknown[]) {
      super(...args);
      (this as unknown as JsPdf).save = ((name: string) => {
        const doc = this as unknown as JsPdf;
        const bytes = Buffer.from(doc.output("arraybuffer"));
        if (process.env.SLIPS_PDF_OUT) require("fs").writeFileSync(process.env.SLIPS_PDF_OUT, bytes);
        saved = { name, pages: doc.getNumberOfPages(), text: bytes.toString("latin1") };
        return doc;
      }) as JsPdf["save"];
    }
  }
  return { ...actual, jsPDF: CapturingPdf, default: CapturingPdf };
});

import { downloadRequestSlipsPdf, type SlipEntry } from "@/features/reports/utils/requestSlipsPdf";
import type { ItemRequest, ReimbursementRequest, ServiceRequest, UrgentRequest } from "@/types";

const base = {
  created_at: "2026-10-19T08:22:53.000Z",
  created_by: "JOEL",
  requested_by: "JOEL",
  department: "HR",
  purpose: "FOR PANTRY",
  remarks: "",
  status: "approved",
};

const item: ItemRequest = {
  ...base,
  id: 1,
  serial: "IRS-2026-000013",
  supervisor_approved_by_name: "MARIA SANTOS",
  custodian_approved_by_name: "MARQUEZ, PETER PAUL",
  items: [
    { id: 1, item_name: "ABRADE (MULTI-PURPOSE LIQUID DETERGENTS)", quantity: 5, uom: "GAL/S", remarks: "N/A", machine_code: "", delivery_status: "OUT" },
    { id: 2, item_name: "BOND PAPER LONG", quantity: 2, uom: "REAM/S", remarks: "", machine_code: "", delivery_status: "HOLD" },
  ],
} as ItemRequest;

const service: ServiceRequest = {
  ...base,
  id: 2,
  serial: "SRS-2026-000003",
  pr_number: "PR-100",
  services: [{ id: 1, description: "AIRCON CLEANING", delivery_status: "pending" }],
} as ServiceRequest;

const urgent: UrgentRequest = {
  ...base,
  id: 3,
  serial: "URS-2026-000001",
  supervisor_status: "approved",
  stockroom_status: "pending",
  items: [{ item_description: "FUSE 10A", quantity: 3, uom: "PC", is_inventoriable: true, amount: "1250.5" }],
};

const reimbursement: ReimbursementRequest = {
  ...base,
  id: 4,
  serial: "RRS-2026-000001",
  supplier: "ACE HARDWARE",
  supervisor_status: "approved",
  purchaser_status: "approved",
  ap_status: "pending",
  total_cost: "300",
  items: [{ item_description: "TAPE", quantity: 2, uom: "ROLL", amount: "300" }],
};

const entries: SlipEntry[] = [
  { source: { kind: "item", request: item }, statusText: "Approved (Custodian)" },
  { source: { kind: "service", request: service }, statusText: "Approved (Custodian)" },
  { source: { kind: "urgent", request: urgent }, statusText: "For Stockroom Review" },
  { source: { kind: "reimbursement", request: reimbursement }, statusText: "For AP Officer" },
];

describe("downloadRequestSlipsPdf", () => {
  beforeEach(() => {
    saved = null;
  });

  it("puts each request on its own page, for every request type", async () => {
    await downloadRequestSlipsPdf(entries, "request-printouts-all");

    expect(saved?.name).toBe("request-printouts-all.pdf");
    expect(saved?.pages).toBe(4);
    for (const serial of ["IRS-2026-000013", "SRS-2026-000003", "URS-2026-000001", "RRS-2026-000001"]) {
      expect(saved?.text).toContain(serial);
    }
    // PDF string syntax escapes parentheses.
    expect(saved?.text).toContain("ITEM REQUEST SLIP \\(IRS\\)");
    expect(saved?.text).toContain("REIMBURSEMENT REQUEST");
    expect(saved?.text).toContain("PHP 1,250.50");
    expect(saved?.text).toContain("Page 4 of 4");
  });

  it("still produces a slip for a request with no lines", async () => {
    await downloadRequestSlipsPdf([{ source: { kind: "item", request: { ...item, items: [] } }, statusText: "Pending" }], "empty.pdf");

    expect(saved?.pages).toBe(1);
    expect(saved?.text).toContain("No records found");
  });
});
