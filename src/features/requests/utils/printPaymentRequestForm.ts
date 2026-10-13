import logo from '@/assets/svg.svg';
import { escapeHTML } from '@/lib/utils/escapeHTML';
import type { PaymentRequestFormLike } from '@/features/requests/components/PaymentRequestFormFields';

export const printPaymentRequestForm = (form: PaymentRequestFormLike, requestSerial: string): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const logoSrc = typeof logo === 'string' ? logo : (logo as { src?: string }).src || '';

  const formatDate = (value?: string | null): string => {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return '';
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return '';
    }
  };

  const formatAmount = (value?: string | number | null) => Number(value || 0).toFixed(2);

  const particularsRowsHTML = form.particulars.length > 0
    ? form.particulars.map((line) => `
        <tr>
          <td class="particulars-cell">${escapeHTML(line.description)}</td>
          <td class="qty-cell">${line.quantity ?? ''}</td>
          <td class="uom-cell">${escapeHTML(line.uom)}</td>
          <td class="amount-cell">${formatAmount(line.amount)}</td>
        </tr>
      `).join('')
    : `<tr><td class="particulars-cell">No items routed as Payment Request.</td><td class="qty-cell"></td><td class="uom-cell"></td><td class="amount-cell">0.00</td></tr>`;

  const totalParticulars = form.particulars.length || 1;
  const targetRows = 4;
  const emptyRowsNeeded = Math.max(0, targetRows - totalParticulars);
  const blankRowsHTML = `<tr><td class="particulars-cell">&nbsp;</td><td class="qty-cell"></td><td class="uom-cell"></td><td class="amount-cell"></td></tr>`.repeat(emptyRowsNeeded);

  const printContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Request - ${escapeHTML(requestSerial)}</title>
        <style>
          @page { size: auto; margin: 10mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #000; font-size: 11px; }
          
          /* Split into two tables (header-table / form-table) rather than one —
             a single shared table forces every cell in "column 1" to the same
             rendered width, so logo-cell (header row) and particulars-cell
             (item rows) fought over that width and particulars-cell's 45%
             always won, no matter what width logo-cell declared. Separate
             tables give the header row its own independent column model,
             styled to still read as one continuous bordered form (no border
             between them). */
          table.header-table, table.form-table { width: 100%; border-collapse: collapse; }
          table.header-table td, table.header-table th,
          table.form-table td, table.form-table th { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
          table.header-table { border: 2px solid #000; border-bottom: none; }
          table.form-table { border: 2px solid #000; border-top: none; }

          .top-header td { text-align: center; font-size: 11px; font-weight: bold; padding: 3px; }
          
          .header-row { height: 50px; }
          .logo-cell {
            width: 15%;
            text-align: center;
            vertical-align: middle;
            padding: 4px;
            box-sizing: border-box;
          }
          .logo-cell img {
            max-width: 120px;
            max-height: 30px;
            object-fit: contain;
            display: block;
            margin: 0 auto 2px auto;
          }
          .dept-label { 
            font-size: 9px; 
            font-style: italic; 
            font-weight: normal; 
            line-height: 1; 
            color: #000;
          }

          .title-cell { text-align: center; vertical-align: middle; padding: 4px; }
          .title-cell h1 { margin: 0; font-size: 14px; font-weight: bold; letter-spacing: 0.5px; }
          .title-cell .form-code { font-size: 10px; font-weight: normal; margin-top: 1px; }

          .meta-row td { padding: 8px 12px; }
          .meta-table { width: 100%; border-collapse: collapse; }
          .meta-table td { border: none !important; padding: 4px 0; font-size: 11px; vertical-align: middle; }
          .meta-label { font-weight: bold; width: 90px; text-transform: uppercase; white-space: nowrap; }
          .meta-label-right { font-weight: bold; text-transform: uppercase; text-align: right; white-space: nowrap; padding-right: 6px; width: 100px; }
          .meta-value-container { white-space: nowrap; }
          .meta-value { border-bottom: 1px solid #000; min-width: 150px; display: inline-block; padding: 0 4px; font-weight: bold; text-transform: uppercase; }

          .particulars-header td { text-align: center; font-weight: bold; text-transform: uppercase; font-size: 11px; padding: 6px 4px; }
          .particulars-header-label { width: 45%; text-align: center; font-weight: bold; text-transform: uppercase; }
          .particulars-cell { width: 45%; font-weight: bold; vertical-align: middle; line-height: 1.2; height: 24px; text-transform: uppercase; }
          .qty-cell { width: 15%; text-align: center; vertical-align: middle; font-weight: bold; }
          .uom-cell { width: 15%; text-align: center; vertical-align: middle; font-weight: bold; text-transform: uppercase; }
          .amount-cell { width: 25%; text-align: right; vertical-align: middle; font-weight: bold; padding-right: 8px !important; }

          .note-row td { font-weight: bold; text-transform: uppercase; padding: 6px 8px; }
          .total-row td { font-weight: bold; }
          .total-label { text-align: right; font-weight: bold; text-transform: uppercase; padding-right: 8px !important; }
          
          .sign-row td {
            border-bottom: 1px solid #000;
            padding: 40px 15px 15px 15px !important;
            vertical-align: bottom;
          }
          .sign-table { 
            width: 100%; 
            border: none; 
            border-collapse: collapse; 
          }
          .sign-col { 
            border: none !important; 
            width: 33.33%; 
            padding: 0 15px !important; 
            text-align: center; 
            vertical-align: bottom; 
          }
          .sign-box { 
            display: inline-block; 
            width: 100%; 
          }
          .sign-name { 
            border-bottom: 1px solid #000; 
            font-weight: bold; 
            text-transform: uppercase; 
            padding-bottom: 2px; 
            min-height: 16px; 
            font-size: 11px; 
          }
          .sign-label { 
            font-size: 10px; 
            font-weight: bold; 
            margin-top: 4px; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
            color: #000;
          }

          .rev-row td { border: none; text-align: right; font-size: 9px; padding: 2px 8px 4px 0; }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr class="top-header">
            <td colspan="4">FORM</td>
          </tr>
          <tr class="header-row">
            <td class="logo-cell">
              ${logoSrc ? `<img src="${logoSrc}" alt="Staples Food Corporation" />` : ''}
              <div class="dept-label">Accounting Department</div>
            </td>
            <td class="title-cell" colspan="3">
              <h1>PAYMENT REQUEST</h1>
              <div class="form-code">F-ACC-003</div>
            </td>
          </tr>
          <tr class="meta-row">
            <td colspan="4">
              <table class="meta-table">
                <tr>
                  <td class="meta-label">PAYEE</td>
                  <td class="meta-value-container">: <span class="meta-value">${escapeHTML(form.payee)}</span></td>
                  <td class="meta-label-right">DATE</td>
                  <td class="meta-value-container" style="width: 140px;">: <span class="meta-value">${formatDate(form.date)}</span></td>
                </tr>
                <tr>
                  <td class="meta-label">DEPARTMENT</td>
                  <td class="meta-value-container">: <span class="meta-value">${escapeHTML(form.department)}</span></td>
                  <td class="meta-label-right">DATE NEEDED</td>
                  <td class="meta-value-container" style="width: 140px;">: <span class="meta-value">${formatDate(form.date_needed)}</span></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table class="form-table">
          <tr class="particulars-header">
            <td class="particulars-header-label">URGENT ITEM NEEDED</td>
            <td style="width: 15%;">QTY</td>
            <td style="width: 15%;">UOM</td>
            <td style="width: 25%;">AMOUNT</td>
          </tr>
          ${particularsRowsHTML}
          ${blankRowsHTML}
          <tr class="note-row">
            <td colspan="4">NOTE: ${escapeHTML(form.note || '')}</td>
          </tr>
          <tr class="total-row">
            <td class="total-label" colspan="3">TOTAL AMOUNT DUE:</td>
            <td class="amount-cell">${formatAmount(form.total_amount_due)}</td>
          </tr>
          <tr class="sign-row">
            <td colspan="4">
              <table class="sign-table">
                <tr>
                  <td class="sign-col">
                    <div class="sign-box">
                      <div class="sign-name">${escapeHTML(form.prepared_by) || '&nbsp;'}</div>
                      <div class="sign-label">PREPARED BY</div>
                    </div>
                  </td>
                  <td class="sign-col">
                    <div class="sign-box">
                      <div class="sign-name">${escapeHTML(form.checked_by) || '&nbsp;'}</div>
                      <div class="sign-label">CHECKED BY</div>
                    </div>
                  </td>
                  <td class="sign-col">
                    <div class="sign-box">
                      <div class="sign-name">${escapeHTML(form.approved_by) || '&nbsp;'}</div>
                      <div class="sign-label">APPROVED BY</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr class="rev-row">
            <td colspan="4">Rev. 00 6/25/25</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  printWindow.document.write(printContent);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.print();
  };
};