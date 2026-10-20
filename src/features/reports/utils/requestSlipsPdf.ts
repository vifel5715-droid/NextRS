import { jsPDF } from "jspdf";
import { autoTable, type RowInput } from "jspdf-autotable";
import logo from "@/assets/svg.svg";
import { getItemStatusText } from "@/lib/utils/status";
import type { ItemRequest, ReimbursementRequest, ServiceRequest, UrgentRequest } from "@/types";

export type SlipSource =
  | { kind: "item"; request: ItemRequest }
  | { kind: "service"; request: ServiceRequest }
  | { kind: "urgent"; request: UrgentRequest }
  | { kind: "reimbursement"; request: ReimbursementRequest };

export interface SlipEntry {
  source: SlipSource;
  /** The request's current status as the page shows it (e.g. "Approved (Custodian)"). */
  statusText: string;
}

const COMPANY_ADDRESS = "Rosas Norte, McArthur Highway, Barangay Saluysoy, Meycauayan, Bulacan";

const PAGE_MARGIN = 14;
const TEXT_DARK: [number, number, number] = [17, 17, 17];
const TEXT_MUTED: [number, number, number] = [85, 85, 85];
const BORDER: [number, number, number] = [51, 51, 51];

const text = (value: unknown, fallback = "N/A"): string => {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s || fallback;
};
const blank = (value: unknown): string => text(value, "");
const date = (value?: string | null): string => (value ? new Date(value).toLocaleDateString() : "N/A");
// The built-in PDF fonts have no peso sign, so amounts are written "PHP 1,234.50".
const amount = (value?: string | number | null): string =>
  value === null || value === undefined || value === ""
    ? "—"
    : `PHP ${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface SlipLayout {
  title: string;
  serial: string;
  details: Array<[string, string]>;
  linesHeading: string;
  head: string[];
  body: RowInput[];
  foot?: RowInput[];
  columnStyles?: Record<number, { halign?: "left" | "right" | "center"; cellWidth?: number | "auto" }>;
  signatures: Array<[string, string]>;
}

function layoutFor({ source, statusText }: SlipEntry): SlipLayout {
  if (source.kind === "item") {
    const r = source.request;
    const items = r.items ?? [];
    return {
      title: "Item Request Slip (IRS)",
      serial: text(r.serial),
      details: [
        ["Department", text(r.department)],
        ["Created Date", date(r.created_at)],
        ["Requested By", text(r.requested_by || r.created_by)],
        ["Purpose", text(r.purpose)],
        ["Remarks", text(r.remarks)],
        ["Status", text(statusText)],
      ],
      linesHeading: "Items Details",
      head: ["#", "Item Name", "Quantity", "UoM", "Remarks", "Machine Code", "Status"],
      body: items.map((item, i) => [
        i + 1,
        blank(item.item_name),
        blank(item.quantity),
        blank(item.uom),
        blank(item.remarks),
        blank(item.machine_code),
        item.delivery_status ? getItemStatusText(item) : "",
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 8 }, 2: { halign: "center" } },
      signatures: [
        ["Approved By", blank(r.supervisor_name || r.supervisor_approved_by_name)],
        ["Custodian Approved By", blank(r.custodian_name || r.custodian_approved_by_name)],
      ],
    };
  }

  if (source.kind === "service") {
    const r = source.request;
    return {
      title: "Service Request Slip (SRS)",
      serial: text(r.serial),
      details: [
        ["Department", text(r.department)],
        ["Created Date", date(r.created_at)],
        ["Requested By", text(r.requested_by || r.created_by)],
        ["Purpose", text(r.purpose)],
        ["Remarks", text(r.remarks)],
        ["Status", text(statusText)],
        ["PR Number", text(r.pr_number)],
        ["Custodian", text(r.pr_number_updated_by_name)],
        ["Date Entered", date(r.pr_number_updated_at as string | undefined)],
      ],
      linesHeading: "Services Details",
      head: ["#", "Description", "Delivery Status", "PR Number"],
      body: (r.services ?? []).map((service, i) => [
        i + 1,
        blank(service.description),
        blank(service.delivery_status).toUpperCase(),
        blank(service.pr_number),
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 8 } },
      signatures: [
        ["Approved By", blank(r.supervisor_name || r.supervisor_approved_by_name)],
        ["Custodian Approved By", blank(r.custodian_name || r.custodian_approved_by_name)],
      ],
    };
  }

  if (source.kind === "urgent") {
    const r = source.request;
    return {
      title: "Urgent Request Slip",
      serial: text(r.serial),
      details: [
        ["Department", text(r.department)],
        ["Created Date", date(r.created_at)],
        ["Requested By", text(r.requested_by || r.created_by)],
        ["Purpose", text(r.purpose)],
        ["Date Needed", date(r.date_needed)],
        ["Status", text(statusText)],
        ["Remarks", text(r.remarks)],
      ],
      linesHeading: "Items Details",
      head: ["#", "Item Description", "Qty", "UoM", "Inventoriable", "Amount"],
      body: r.items.map((item, i) => [
        i + 1,
        blank(item.item_description),
        blank(item.quantity),
        blank(item.uom),
        item.is_inventoriable ? "Yes" : "No",
        amount(item.amount),
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 8 }, 2: { halign: "center" }, 5: { halign: "right" } },
      signatures: [
        ["Approved By", blank(r.supervisor_approved_by_name)],
        ["Stockroom Noted By", blank(r.stockroom_approved_by_name)],
      ],
    };
  }

  const r = source.request;
  return {
    title: "Reimbursement Request",
    serial: text(r.serial),
    details: [
      ["Department", text(r.department)],
      ["Created Date", date(r.created_at)],
      ["Requested By", text(r.requested_by || r.created_by)],
      ["Purpose", text(r.purpose)],
      ["Supplier", text(r.supplier)],
      ["Date Needed", date(r.date_needed)],
      ["Status", text(statusText)],
      ["Remarks", text(r.remarks)],
    ],
    linesHeading: "Items Details",
    head: ["#", "Item Description", "Qty", "UoM", "Amount"],
    body: r.items.map((item, i) => [i + 1, blank(item.item_description), blank(item.quantity), blank(item.uom), amount(item.amount)]),
    foot: [[{ content: "Total Cost", colSpan: 4, styles: { halign: "right" } }, amount(r.total_cost)]],
    columnStyles: { 0: { halign: "center", cellWidth: 8 }, 2: { halign: "center" }, 4: { halign: "right" } },
    signatures: [
      ["Approved By", blank(r.supervisor_approved_by_name)],
      ["Purchaser", blank(r.purchaser_approved_by_name)],
      ["AP Officer", blank(r.ap_approved_by_name)],
    ],
  };
}

/** Rasterises the SVG logo once so jsPDF (which can't draw SVG) can embed it. */
async function loadLogoPng(): Promise<{ data: string; ratio: number } | null> {
  const src = typeof logo === "string" ? logo : (logo as { src?: string })?.src;
  if (!src) return null;
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo failed to load"));
      img.src = src;
    });
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 100;
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/png"), ratio: width / height };
  } catch {
    return null;
  }
}

const lastTableY = (doc: jsPDF, fallback: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;

function drawSlip(doc: jsPDF, layout: SlipLayout, logoPng: { data: string; ratio: number } | null): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  // Header box: logo | title + address | slip no.
  const headerHeight = 20;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(PAGE_MARGIN, y, contentWidth, headerHeight, 1.5, 1.5);
  if (logoPng) {
    const logoHeight = 12;
    const logoWidth = Math.min(36, logoHeight * logoPng.ratio);
    doc.addImage(logoPng.data, "PNG", PAGE_MARGIN + 3, y + (headerHeight - logoHeight) / 2, logoWidth, logoHeight);
  }
  doc.setTextColor(...TEXT_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(layout.title.toUpperCase(), pageWidth / 2, y + 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(COMPANY_ADDRESS, pageWidth / 2, y + 14, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("SLIP NO.", pageWidth - PAGE_MARGIN - 3, y + 8, { align: "right" });
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(layout.serial, pageWidth - PAGE_MARGIN - 3, y + 14, { align: "right" });
  y += headerHeight + 6;

  // Details: two columns of label/value pairs, values wrap within their column.
  const colWidth = contentWidth / 2;
  const labelWidth = 27;
  doc.setFontSize(9);
  for (let i = 0; i < layout.details.length; i += 2) {
    const pair = layout.details.slice(i, i + 2);
    let rowHeight = 0;
    pair.forEach(([label, value], col) => {
      const x = PAGE_MARGIN + col * colWidth;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...TEXT_MUTED);
      doc.text(`${label}:`, x, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_DARK);
      const lines = doc.splitTextToSize(value, colWidth - labelWidth - 4) as string[];
      doc.text(lines, x + labelWidth, y);
      rowHeight = Math.max(rowHeight, lines.length * 4.2);
    });
    y += Math.max(rowHeight, 4.2) + 1.6;
  }
  y += 3;

  // Lines table heading + table.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text(layout.linesHeading.toUpperCase(), PAGE_MARGIN, y);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y + 1.5, pageWidth - PAGE_MARGIN, y + 1.5);
  y += 4;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 18 },
    head: [layout.head],
    body: layout.body.length ? layout.body : [[{ content: "No records found", colSpan: layout.head.length, styles: { halign: "center", textColor: [102, 102, 102] } }]],
    foot: layout.foot,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, textColor: TEXT_DARK, lineColor: [222, 226, 230], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: { fillColor: [248, 249, 250], textColor: TEXT_DARK, fontStyle: "bold" },
    footStyles: { fillColor: [248, 249, 250], textColor: TEXT_DARK, fontStyle: "bold" },
    columnStyles: layout.columnStyles,
  });
  y = lastTableY(doc, y) + 14;

  // Sign-off: names over a line, so the slip can still be signed by hand.
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + 16 > pageHeight - 18) {
    doc.addPage();
    y = PAGE_MARGIN + 10;
  }
  const slotWidth = contentWidth / layout.signatures.length;
  layout.signatures.forEach(([label, name], i) => {
    const x = PAGE_MARGIN + i * slotWidth;
    const lineWidth = slotWidth - 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    if (name) doc.text(doc.splitTextToSize(name, lineWidth) as string[], x + lineWidth / 2, y, { align: "center" });
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(x, y + 2, x + lineWidth, y + 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label, x + lineWidth / 2, y + 6, { align: "center" });
  });
}

/**
 * Builds one PDF holding a printout slip per request (each starting on its
 * own A4 page, in the order given) and downloads it.
 */
export async function downloadRequestSlipsPdf(entries: SlipEntry[], fileName: string): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const logoPng = await loadLogoPng();
  const generatedAt = new Date().toLocaleString();

  entries.forEach((entry, index) => {
    if (index > 0) doc.addPage();
    drawSlip(doc, layoutFor(entry), logoPng);
  });

  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.text(`Generated ${generatedAt}`, PAGE_MARGIN, pageHeight - 8);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - PAGE_MARGIN, pageHeight - 8, { align: "right" });
  }

  doc.setProperties({ title: fileName.replace(/\.pdf$/i, ""), subject: "Request printouts", creator: "Request System" });
  doc.save(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}
