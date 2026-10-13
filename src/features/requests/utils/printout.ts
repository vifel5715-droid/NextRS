import logo from '@/assets/svg.svg'; // Ensure this resolves to a string URL, or pass a public path '/STPL.svg'
import { escapeHTML } from '@/lib/utils/escapeHTML';

interface PrintableItem {
  item_name?: string;
  quantity?: string | number;
  uom?: string;
  remarks?: string;
  machine_code?: string;
}

interface PrintableService {
  description?: string;
}

export interface PrintableRequest {
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

/**
 * Utility to safely escape HTML characters to prevent XSS and layout breaking
 */

export const printoutslip = (
  details: PrintableRequest,
  requestType: 'item' | 'service'
): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const isItem = requestType === 'item';
  const typeLabel = isItem ? 'Item Request Slip (IRS)' : 'Service Request Slip (SRS)';
  const fieldsLabel = isItem ? 'Items' : 'Services';
  const rows = isItem ? details.items || [] : details.services || [];

  const headers = isItem
    ? ['#', 'Item Name', 'Quantity', 'UoM', 'Remarks', 'Machine Code']
    : ['#', 'Description'];

  const thStyle = 'border:1px solid #dee2e6;padding:6px 8px;text-align:left;background-color:#f8f9fa;font-weight:bold;';
  const tdStyle = 'border:1px solid #dee2e6;padding:6px 8px;';
  const numTdStyle = `${tdStyle}text-align:center;width:30px;`;

  const tableHeadersHTML = headers
    .map((h) => `<th style="${thStyle}">${escapeHTML(h)}</th>`)
    .join('');

  const tableRowsHTML =
    rows.length > 0
      ? rows
          .map((item, index) => {
            if (isItem) {
              const printableItem = item as PrintableItem;
              return `
                <tr>
                  <td style="${numTdStyle}">${index + 1}</td>
                  <td style="${tdStyle}">${escapeHTML(printableItem.item_name)}</td>
                  <td style="${tdStyle}">${escapeHTML(printableItem.quantity)}</td>
                  <td style="${tdStyle}">${escapeHTML(printableItem.uom)}</td>
                  <td style="${tdStyle}">${escapeHTML(printableItem.remarks)}</td>
                  <td style="${tdStyle}">${escapeHTML(printableItem.machine_code)}</td>
                </tr>`;
            }

            const printableService = item as PrintableService;
            return `
              <tr>
                <td style="${numTdStyle}">${index + 1}</td>
                <td style="${tdStyle}">${escapeHTML(printableService.description)}</td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="${headers.length}" style="${tdStyle}text-align:center;color:#666;">No records found</td></tr>`;

  const createdDate = details.created_at
    ? new Date(details.created_at).toLocaleDateString()
    : 'N/A';

  // Fallback check: if Vite/Webpack imports the SVG as an object, extract its string source
  const logoSrc = typeof logo === 'string' ? logo : (logo as { src?: string })?.src || '';

  const printContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHTML(typeLabel)} - ${escapeHTML(details.serial || 'N/A')}</title>
        <style>
          @page { size: auto; margin: 10mm; }
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            color: #333; 
            font-size: 12px; 
            line-height: 1.4;
          }
          
          /* Compact Header Box */
          .header-box { 
            display: flex; 
            align-items: center; 
            justify-content: space-between;
            border: 1.5px solid #333; 
            padding: 8px 12px; 
            margin-bottom: 12px;
            border-radius: 4px;
            page-break-inside: avoid;
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
            padding: 0 10px;
          }
          .header-center h2 { 
            margin: 0; 
            color: #111; 
            font-size: 16px; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
          }
          .company-address { 
            margin: 2px 0 0 0; 
            font-size: 10px; 
            color: #555; 
            line-height: 1.2; 
          }
          
          .header-right {
            flex: 0 0 130px;
            text-align: right;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .serial-label { font-size: 10px; text-transform: uppercase; color: #777; font-weight: bold; }
          .serial-number { font-size: 15px; font-weight: bold; color: rgb(0, 0, 0); letter-spacing: 0.5px; margin-top: 1px; }
          
          /* Details Grid */
          .details { margin: 12px 0; page-break-inside: avoid; }
          .detail-row { display: flex; margin: 4px 0; }
          .detail-col { flex: 1; display: flex; align-items: baseline; }
          .detail-label { font-weight: bold; width: 110px; color: #555; flex-shrink: 0; }
          .detail-value { flex: 1; color: #111; word-break: break-word; }
          
          /* Table Styling */
          h3 { 
            margin: 16px 0 6px 0; 
            border-bottom: 1.5px solid #333; 
            padding-bottom: 3px; 
            font-size: 13px; 
            text-transform: uppercase; 
          }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          tr { page-break-inside: avoid; }

          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
            <h2>${escapeHTML(typeLabel)}</h2>
            <div class="company-address">Rosas Norte, McArthur Highway, Barangay Saluysoy, Meycauayan, Bulacan</div>
          </div>
          <div class="header-right">
            <span class="serial-label">Slip No.</span>
            <div class="serial-number">${escapeHTML(details.serial || 'N/A')}</div>
          </div>
        </div>
        
        <!-- Structured Details Grid -->
        <div class="details">
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Department:</span>
              <span class="detail-value">${escapeHTML(details.department || 'N/A')}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Created Date:</span>
              <span class="detail-value">${escapeHTML(createdDate)}</span>
            </div>
          </div>
          
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Requested By:</span>
              <span class="detail-value">${escapeHTML(details.requested_by || 'N/A')}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Purpose:</span>
              <span class="detail-value">${escapeHTML(details.purpose || 'N/A')}</span>
            </div>
          </div>
          
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Remarks:</span>
              <span class="detail-value">${escapeHTML(details.remarks || 'N/A')}</span>
            </div>
          </div>

          ${!isItem ? `
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">PR Number:</span>
              <span class="detail-value">${escapeHTML(details.pr_number || 'N/A')}</span>
            </div>
            <div class="detail-col">
              <span class="detail-label">Custodian:</span>
              <span class="detail-value">${escapeHTML(details.pr_number_updated_by_name || 'N/A')}</span>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-col">
              <span class="detail-label">Date Entered:</span>
              <span class="detail-value">${escapeHTML(details.pr_number_updated_at ? new Date(details.pr_number_updated_at).toLocaleDateString() : 'N/A')}</span>
            </div>
          </div>
          ` : ''}
        </div>

        <h3>${escapeHTML(fieldsLabel)} Details</h3>
        <table>
          <thead><tr>${tableHeadersHTML}</tr></thead>
          <tbody>${tableRowsHTML}</tbody>
        </table>

        <!-- Approved By — moved below the ${escapeHTML(fieldsLabel)} Details table so it
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

  printWindow.document.open();
  printWindow.document.write(printContent);
  printWindow.document.close();

  // Safely trigger print dialog after document rendering completes
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