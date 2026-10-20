import logo from '@/assets/svg.svg'; // Ensure this resolves to a string URL, or pass a public path '/STPL.sv
import { escapeHTML } from '@/lib/utils/escapeHTML';

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

export const printRequestSlip = (details: PrintableRequest, requestType: 'item' | 'service'): void => {
  // BINAGO: Tinanggal ang 'width=800,height=600' para magbukas bilang NEW TAB sa browser
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const isItem = requestType === 'item';
  const typeLabel = isItem ? 'Item Request Slip (IRS)' : 'Service Request Slip (SRS)';
  const fieldsLabel = isItem ? 'Items' : 'Services';
  
  let rows: (PrintableItem | PrintableService)[] = [];
  if (isItem) {
    rows = details.items || [];
  } else {
    rows = details.services || [];
  }
  
  // The IRS purchase slip prints what is still outstanding — the item's
  // remaining balance (requested minus already released), not the original
  // requested quantity — and drops rows with nothing left to purchase.
  // qty_balance comes from the server; the fallback recomputes the same
  // figure for any caller that hands in a row without it. Printing never
  // writes anything back.
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

  const thStyle = 'border:1px solid #dee2e6;padding:5px 8px;text-align:left;background-color:#f8f9fa;';
  const tdStyle = 'border:1px solid #dee2e6;padding:5px 8px;';
  const numTdStyle = `${tdStyle}text-align:center;width:30px;`;

  const tableHeadersHTML = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('');
  const tableRowsHTML = printableRows.length > 0
    ? printableRows.map((item, index: number) => {
        const record = item as unknown as Record<string, unknown>;
        return `<tr><td style="${numTdStyle}">${index + 1}</td>${dataKeys.map(k => `<td style="${tdStyle}">${escapeHTML(String(record[k] ?? ''))}</td>`).join('')}</tr>`;
      }).join('')
    : `<tr><td colspan="${headers.length}" style="${tdStyle}text-align:center;color:#666;">No records found</td></tr>`;

  const createdDate = details.created_at ? new Date(details.created_at).toLocaleDateString() : 'N/A';

  const logoSrc = typeof logo === 'string' ? logo : (logo as { src?: string }).src || '';

  const printContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${typeLabel} - ${escapeHTML(details.serial) || 'N/A'}</title>
        <style>
          @page { size: auto; margin: 0mm; }
          body { font-family: Arial, sans-serif; margin: 15px 25px; color: #333; font-size: 12px; }
          
          /* Compact Header Box */
          .header-box { 
            display: flex; 
            align-items: center; 
            justify-content: space-between;
            border: 1.5px solid #333; 
            padding: 8px 12px; 
            margin-bottom: 12px;
            border-radius: 4px;
          }
          .logo-container {
            flex: 0 0 120px;
            display: flex;
            justify-content: flex-start;
            align-items: center;
          }
          .logo { max-height: 45px; width: auto; object-fit: contain; }
          
          .header-center { 
            flex: 1; 
            text-align: center; 
            padding: 0 5px;
          }
          .header-center h2 { margin: 0; color: #111; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
          .company-address { margin: 2px 0 0 0; font-size: 10px; color: #666; line-height: 1.2; }
          
          .header-right {
            flex: 0 0 150px;
            text-align: right;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .serial-label { font-size: 10px; text-transform: uppercase; color: #777; font-weight: bold; }
          .serial-number { font-size: 15px; font-weight: bold; color: hsl(0, 0%, 0%); letter-spacing: 0.5px; margin-top: 1px; }
          
          /* Compressed 2-Column Details Layout */
          .details { margin: 10px 0; line-height: 1.4; }
          .detail-row { display: flex; margin: 3px 0; }
          .detail-col { flex: 1; display: flex; }
          .detail-label { font-weight: bold; width: 100px; color: #555; }
          .detail-value { flex: 1; color: #111; }
          
          /* Compact Table Styling */
          h3 { margin: 15px 0 5px 0; border-bottom: 1.5px solid #333; padding-bottom: 3px; font-size: 13px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
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
        
        <!-- Combined & Compressed Details -->
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
          </div>

          ${!isItem ? `
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
              <span class="detail-value">${details.pr_number_updated_at ? new Date(details.pr_number_updated_at).toLocaleDateString() : 'N/A'}</span>
            </div>
          </div>
          ` : ''}
        </div>

        <h3>${fieldsLabel} Details</h3>
        <table>
          <thead><tr>${tableHeadersHTML}</tr></thead>
          <tbody>${tableRowsHTML}</tbody>
        </table>

        <!-- Approved By — moved below the ${fieldsLabel} Details table so it
             reads as a sign-off on the finished slip rather than a header field.
             Left blank (no "N/A" fallback) so there's a real line to sign, with
             extra spacing so the two signature blocks don't crowd each other. -->
        <div class="details" style="margin-top: 40px;">
          <div class="detail-row">
            <div class="detail-col" style="margin-right: 60px;">
              <span class="detail-label" style="width: 130px;">Approved By:</span>
              <span class="detail-value">${escapeHTML(details.supervisor_name || details.supervisor_approved_by_name)}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label" style="width: 150px;">Custodian Approved By:</span>
              <span class="detail-value">${escapeHTML(details.custodian_name || details.custodian_approved_by_name)}</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(printContent);
  printWindow.document.close();
  
  // BINAGO: Ginamit ang .onload kaysa setTimeout para siguradong loaded ang SVG logo bago mag-print
  printWindow.onload = () => {
    printWindow.print();
  };
};