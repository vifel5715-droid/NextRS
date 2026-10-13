import logo from '@/assets/svg.svg';
import { escapeHTML } from '@/lib/utils/escapeHTML';
import { formatMilitaryDateTime } from '@/lib/utils/format';
import type { ItemRow } from '@/types';

export interface AdjustmentChange {
  itemLabel: string;
  field: string;
  before: string;
  after: string;
}

const TRACKED_FIELDS: { key: keyof ItemRow; label: string }[] = [
  { key: 'item_name', label: 'Item Name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'uom', label: 'UoM' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'machine_code', label: 'Machine Code' },
];

const toDisplayValue = (value: unknown): string =>
  value === undefined || value === null || value === '' ? 'N/A' : String(value);

/** Diffs the adjustable fields (Item Name, Quantity, UoM, Remarks, Machine Code)
 * of one item row against its pre-edit snapshot. `itemLabel` identifies the row
 * in the printed comparison (e.g. "Item #2 — BALL BEARIN"). */
export const diffItemRow = (before: ItemRow, after: ItemRow, itemLabel: string): AdjustmentChange[] => {
  const changes: AdjustmentChange[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const beforeStr = toDisplayValue(before?.[key]);
    const afterStr = toDisplayValue(after?.[key]);
    if (beforeStr !== afterStr) {
      changes.push({ itemLabel, field: label, before: beforeStr, after: afterStr });
    }
  }
  return changes;
};

export interface AdjustmentHistoryEntry {
  /** Reference number for the whole adjustment event this row is part of —
   * shared by every field changed in the same Save click. Null on rows
   * written before this existed and never backfilled. */
  adjustment_serial: string | null;
  request_serial: string;
  item_label: string;
  field: string;
  before_value: string | null;
  after_value: string | null;
  adjustment_remarks: string;
  /** Department of the user who made the adjustment — what's printed as
   * "Department", not the request's own department. */
  adjusted_by_department: string;
  adjusted_by_name: string;
  adjusted_by_role: string;
  adjusted_at: string;
}

/**
 * Prints the full Adjustment History list for one request — every row the
 * Adjustment History modal shows (see AdjustmentHistoryModal.tsx), including
 * Date/Time and Department per entry, as a browser print/Save-as-PDF job.
 */
export const printAdjustmentHistory = (entries: AdjustmentHistoryEntry[], requestSerial?: string): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const thStyle = 'border:1px solid #dee2e6;padding:6px 8px;text-align:left;background-color:#f8f9fa;font-weight:bold;';
  const tdStyle = 'border:1px solid #dee2e6;padding:6px 8px;';

  const tableRowsHTML = entries.length > 0
    ? entries.map((e, index) => `
        <tr>
          <td style="${tdStyle}text-align:center;width:30px;">${index + 1}</td>
          <td style="${tdStyle}white-space:nowrap;font-weight:bold;">${escapeHTML(e.adjustment_serial ?? '—')}</td>
          <td style="${tdStyle}white-space:nowrap;">${escapeHTML(e.request_serial)}</td>
          <td style="${tdStyle}white-space:nowrap;">${escapeHTML(formatMilitaryDateTime(e.adjusted_at))}</td>
          <td style="${tdStyle}">${escapeHTML(e.adjusted_by_department)}</td>
          <td style="${tdStyle}">${escapeHTML(e.item_label)}</td>
          <td style="${tdStyle}">${escapeHTML(e.field)}</td>
          <td style="${tdStyle}color:#b91c1c;">${escapeHTML(e.before_value ?? 'N/A')}</td>
          <td style="${tdStyle}color:#15803d;">${escapeHTML(e.after_value ?? 'N/A')}</td>
          <td style="${tdStyle}">${escapeHTML(e.adjustment_remarks || '—')}</td>
          <td style="${tdStyle}white-space:nowrap;">${escapeHTML(e.adjusted_by_name)} (${escapeHTML(e.adjusted_by_role)})</td>
        </tr>`).join('')
    : `<tr><td colspan="11" style="${tdStyle}text-align:center;color:#666;">No adjustments recorded</td></tr>`;

  const logoSrc = typeof logo === 'string' ? logo : (logo as { src?: string })?.src || '';
  const printedAt = formatMilitaryDateTime(new Date().toISOString());

  const printContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Adjustment History - ${escapeHTML(requestSerial || 'N/A')}</title>
        <style>
          @page { size: landscape; margin: 10mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #333; font-size: 12px; line-height: 1.4; }
          .header-box { display: flex; align-items: center; justify-content: space-between; border: 1.5px solid #333; padding: 8px 12px; margin-bottom: 12px; border-radius: 4px; page-break-inside: avoid; }
          .logo-container { flex: 0 0 120px; display: flex; justify-content: flex-start; align-items: center; }
          .logo { max-height: 45px; width: auto; object-fit: contain; }
          .header-center { flex: 1; text-align: center; padding: 0 10px; }
          .header-center h2 { margin: 0; color: #111; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .company-address { margin: 2px 0 0 0; font-size: 10px; color: #555; line-height: 1.2; }
          .header-right { flex: 0 0 160px; text-align: right; display: flex; flex-direction: column; justify-content: center; }
          .serial-label { font-size: 10px; text-transform: uppercase; color: #777; font-weight: bold; }
          .serial-number { font-size: 15px; font-weight: bold; color: rgb(0, 0, 0); letter-spacing: 0.5px; margin-top: 1px; }
          .printed-at { font-size: 9px; color: #777; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          tr { page-break-inside: avoid; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="header-box">
          <div class="logo-container">
            ${logoSrc ? `<img src="${logoSrc}" alt="Company Logo" class="logo" />` : ''}
          </div>
          <div class="header-center">
            <h2>Adjustment History</h2>
            <div class="company-address">Rosas Norte, McArthur Highway, Barangay Saluysoy, Meycauayan, Bulacan</div>
          </div>
          <div class="header-right">
            <span class="serial-label">Request No.</span>
            <div class="serial-number">${escapeHTML(requestSerial || 'N/A')}</div>
            <div class="printed-at">Printed: ${escapeHTML(printedAt)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="${thStyle}width:30px;">#</th>
              <th style="${thStyle}">Adjustment No.</th>
              <th style="${thStyle}">Serial</th>
              <th style="${thStyle}">Date/Time</th>
              <th style="${thStyle}">Department</th>
              <th style="${thStyle}">Item</th>
              <th style="${thStyle}">Field</th>
              <th style="${thStyle}">Before</th>
              <th style="${thStyle}">After</th>
              <th style="${thStyle}">Remarks</th>
              <th style="${thStyle}">Adjusted By</th>
            </tr>
          </thead>
          <tbody>${tableRowsHTML}</tbody>
        </table>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(printContent);
  printWindow.document.close();

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  if (logoSrc) {
    const img = new Image();
    img.src = logoSrc;
    img.onload = () => setTimeout(triggerPrint, 100);
    img.onerror = () => triggerPrint();
  } else {
    setTimeout(triggerPrint, 150);
  }
};
