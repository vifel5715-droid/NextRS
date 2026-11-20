import logo from '@/assets/svg.svg'; // Ensure this resolves to a string URL, or pass a public path '/STPL.svg'
import { escapeHTML } from '@/lib/utils/escapeHTML';
import { formatPhtDate } from '@/lib/utils/timezone';

interface PrintableItem {
  item_name?: string;
  quantity?: string | number;
  /** Server-computed quantity still to be released (quantity - quantity_out). */
  qty_balance?: number;
  quantity_out?: number;
  uom?: string;
  remarks?: string;
  machine_code?: string;
  delivery_status?: string;
}

interface PrintableService {
  description?: string;
}

interface PrintableRequest {
  serial?: string;
  department?: string;
  requested_by?: string;
  supervisor_name?: string;
  supervisor_approved_by_name?: string;
  custodian_name?: string;
  custodian_approved_by_name?: string;
  purpose?: string;
  remarks?: string;
  created_at?: string;
  items?: PrintableItem[];
  services?: PrintableService[];
  pr_number?: string;
  pr_status?: string;
  /** Custodian who last saved pr_number — service requests only. */
  pr_number_updated_by_name?: string;
  pr_number_updated_at?: string;
}

export const printRequestSlip = (
  details: PrintableRequest,
  requestType: 'item' | 'service'
): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const isItem = requestType === 'item';
  const typeLabel = isItem ? 'Item Request Slip (IRS)' : 'Service Request Slip (SRS)';
  const fieldsLabel = isItem ? 'Items' : 'Services';

  const rows: (PrintableItem | PrintableService)[] = isItem
    ? details.items || []
    : details.services || [];

  const remainingBalance = (item: PrintableItem) => {
    if (typeof item.qty_balance === 'number') return Math.max(0, item.qty_balance);
    return Math.max(0, Number(item.quantity ?? 0) - Number(item.quantity_out ?? 0));
  };

  const printableRows = isItem
    ? (rows as PrintableItem[])
        .filter((item: PrintableItem) => !['OUT', 'HOLD', 'CLOSE'].includes(item.delivery_status ?? ''))
        .filter((item: PrintableItem) => remainingBalance(item) > 0)
        .map((item: PrintableItem) => ({ ...item, quantity: remainingBalance(item) }))
    : (rows as PrintableService[]);

  const headers = isItem
    ? ['#', 'Item Name', 'Quantity', 'UoM', 'Remarks', 'Machine Code']
    : ['#', 'Description'];

  const dataKeys = isItem
    ? ['item_name', 'quantity', 'uom', 'remarks', 'machine_code']
    : ['description'];

  const columnWidths = isItem
    ? ['36px', '30%', '85px', '85px', '24%', '16%']
    : ['36px', 'auto'];

  const thStyle =
    'border:1px solid #d0d5dd;padding:6px 8px;text-align:left;background-color:#ffffff;color:#111;font-weight:700;word-break:break-word;';
  const tdStyle =
    'border:1px solid #d0d5dd;padding:6px 8px;color:#222;vertical-align:top;word-break:break-word;';
  const numCellStyle = 'text-align:center;';

  const tableHeadersHTML = headers
    .map((h, idx) => {
      const widthAttr = columnWidths[idx] ? `width:${columnWidths[idx]};` : '';
      const alignClass = idx === 0 ? numCellStyle : '';
      return `<th style="${thStyle}${widthAttr}${alignClass}">${h}</th>`;
    })
    .join('');

  const tableRowsHTML =
    printableRows.length > 0
      ? printableRows
          .map((item, index: number) => {
            const record = item as unknown as Record<string, unknown>;
            const cells = dataKeys
              .map((k, colIdx) => {
                const extraAlign = isItem && colIdx === 1 ? 'text-align:left;' : '';
                return `<td style="${tdStyle}${extraAlign}">${escapeHTML(String(record[k] ?? ''))}</td>`;
              })
              .join('');
            return `<tr><td style="${tdStyle}${numCellStyle}">${index + 1}</td>${cells}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${headers.length}" style="${tdStyle}text-align:center;color:#666;">No records found</td></tr>`;

  const createdDate = details.created_at ? formatPhtDate(details.created_at) : 'N/A';
  const logoSrc = typeof logo === 'string' ? logo : (logo as { src?: string }).src || '';

  const printContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${typeLabel} - ${escapeHTML(details.serial) || 'N/A'}</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: auto; margin: 10mm; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 12px 20px;
            color: #222;
            font-size: 12px;
          }

          /* Header Box */
          .header-box {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border: 1.5px solid #222;
            padding: 8px 14px;
            margin-bottom: 14px;
            border-radius: 5px;
            background: #fff;
          }
          .logo-container {
            flex: 0 0 140px;
            display: flex;
            justify-content: flex-start;
            align-items: center;
          }
          .logo {
            max-height: 48px;
            max-width: 135px;
            width: auto;
            height: auto;
            object-fit: contain;
          }

          .header-center {
            flex: 1;
            text-align: center;
            padding: 0 10px;
          }
          .header-center h2 {
            margin: 0;
            color: #111;
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }
          .company-address {
            margin: 3px 0 0 0;
            font-size: 10.5px;
            color: #555;
            line-height: 1.25;
          }

          .header-right {
            flex: 0 0 165px;
            text-align: right;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .serial-label {
            font-size: 10px;
            text-transform: uppercase;
            color: #333;
            font-weight: 700;
            letter-spacing: 0.3px;
          }
          .serial-number {
            font-size: 15px;
            font-weight: 700;
            color: #000;
            letter-spacing: 0.4px;
            margin-top: 2px;
          }

          /* 2-Column Metadata Grid */
          .details {
            margin: 8px 0 14px 0;
            line-height: 1.4;
          }
          .detail-row {
            display: flex;
            align-items: flex-start;
            margin-bottom: 6px;
          }
          .detail-col {
            flex: 1;
            display: flex;
            align-items: flex-start;
            padding-right: 16px;
          }
          .detail-col:last-child {
            padding-right: 0;
          }
          .detail-label {
            font-weight: 700;
            width: 115px;
            flex-shrink: 0;
            color: #333;
          }
          .detail-value {
            flex: 1;
            color: #111;
            word-break: break-word;
          }

          /* Section Heading & Table */
          h3 {
            margin: 14px 0 6px 0;
            border-bottom: 1.5px solid #222;
            padding-bottom: 4px;
            font-size: 13px;
            font-weight: 700;
            color: #111;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 11.5px;
          }

          /* Sign-off Footer */
          .signoff {
            margin-top: 36px;
            display: flex;
            align-items: flex-start;
          }
          .signoff-col {
            flex: 1;
            display: flex;
            align-items: flex-start;
            padding-right: 36px;
          }
          .signoff-col:last-child {
            padding-right: 0;
          }
          .signoff-label {
            font-weight: 700;
            color: #333;
            margin-right: 12px;
            white-space: nowrap;
          }
          .signoff-value {
            flex: 1;
            color: #111;
            font-weight: 500;
            min-height: 18px;
          }

          @media print {
            body {
              margin: 0;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header Section -->
        <div class="header-box">
          <div class="logo-container">
            ${logoSrc ? `<img src="${logoSrc}" alt="Company Logo" class="logo" />` : ''}
          </div>
          <div class="header-center">
            <h2>${typeLabel}</h2>
            <div class="company-address">Rosas Norte, McArthur Highway, Barangay Saluysoy, Meycauayan, Bulacan</div>
          </div>
          <div class="header-right">
            <span class="serial-label">Slip No.</span>
            <div class="serial-number">${escapeHTML(details.serial) || 'N/A'}</div>
          </div>
        </div>

        <!-- Request Metadata -->
        <div class="details">
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Department:</span>
              <span class="detail-value">${escapeHTML(details.department) || 'N/A'}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Created Date:</span>
              <span class="detail-value">${createdDate}</span>
            </div>
          </div>

          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Requested By:</span>
              <span class="detail-value">${escapeHTML(details.requested_by) || 'N/A'}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Purpose:</span>
              <span class="detail-value">${escapeHTML(details.purpose) || 'N/A'}</span>
            </div>
          </div>

          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Remarks:</span>
              <span class="detail-value">${escapeHTML(details.remarks) || 'N/A'}</span>
            </div>
            <div class="detail-col"></div>
          </div>

          ${
            !isItem
              ? `
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">PR Number:</span>
              <span class="detail-value">${escapeHTML(details.pr_number) || 'N/A'}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Custodian:</span>
              <span class="detail-value">${escapeHTML(details.pr_number_updated_by_name) || 'N/A'}</span>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Date Entered:</span>
              <span class="detail-value">${details.pr_number_updated_at ? formatPhtDate(details.pr_number_updated_at) : 'N/A'}</span>
            </div>
            <div class="detail-col"></div>
          </div>
          `
              : ''
          }
        </div>

        <h3>${fieldsLabel} Details</h3>
        <table>
          <thead><tr>${tableHeadersHTML}</tr></thead>
          <tbody>${tableRowsHTML}</tbody>
        </table>

        <!-- Sign-off Section -->
        <div class="signoff">
          <div class="signoff-col">
            <span class="signoff-label">Approved In Online By:</span>
            <span class="signoff-value">${escapeHTML(details.supervisor_name || details.supervisor_approved_by_name)}</span>
          </div>
          <div class="signoff-col">
            <span class="signoff-label">Custodian Approved By:</span>
            <span class="signoff-value">${escapeHTML(details.custodian_name || details.custodian_approved_by_name)}</span>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(printContent);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.print();
  };
};