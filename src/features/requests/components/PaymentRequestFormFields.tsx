import React, { useState } from "react";

export type FormFields = {
  payee: string;
  department: string;
  date: string;
  date_needed: string;
  note: string;
  prepared_by: string;
  checked_by: string;
  approved_by: string;
  total_amount_due: string;
};

/**
 * The shared shape both PaymentRequestForm (Urgent Request workflow) and
 * ItemPaymentRequestForm ("Urgent Item From IRS" page) satisfy — this
 * component only reads the header/signature fields and the derived
 * Particulars table, never the request-id field each type keys itself by.
 */
export interface PaymentRequestFormLike {
  payee?: string | null;
  department?: string | null;
  date?: string | null;
  date_needed?: string | null;
  note?: string | null;
  prepared_by?: string | null;
  checked_by?: string | null;
  approved_by?: string | null;
  particulars: Array<{ id: number; description: string; quantity: number | null; uom: string | null; amount: string | null }>;
  total_amount_due: string;
  /** "Submitted Payment Request" — once true, editing is locked to whoever
   * `canEdit` says may still touch it (AP Officer et al). */
  submitted?: boolean;
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  /** Null until the form has been saved at least once — Submit requires an
   * existing row server-side, so it's disabled until this is set. */
  created_at?: string | null;
}

/**
 * The F-ACC-003 "Payment Request" form's editable body — shared by
 * PurchaserDashboard.tsx (Urgent Request workflow) and UrgentItemsPage.tsx
 * ("Urgent Item From IRS" page, regular Item Requests). Owns its own local
 * edit copy of the form fields, seeded once from `form` at mount — remounted
 * (via the parent's `key`) whenever a different request's form loads, so
 * there's no need to sync it back in on every re-render/refetch.
 */
const PaymentRequestFormFields: React.FC<{
  form: PaymentRequestFormLike;
  requestSerial: string;
  saving: boolean;
  onClose: () => void;
  onSave: (fields: FormFields) => void;
  /** "Submitted Payment Request" — renders a Submit button (next to Save)
   * when provided and the form isn't submitted yet. Omit entirely on a
   * viewer (e.g. the Submitted Payment Request page) that shouldn't be able
   * to submit, only save/edit. */
  onSubmit?: () => void;
  submitting?: boolean;
  /** Whether the current viewer may still edit this form once submitted —
   * true for AP Officer et al, false for the Purchaser who submitted it.
   * Irrelevant (no lock at all) while the form isn't submitted yet. */
  canEditAfterSubmit?: boolean;
}> = ({ form, requestSerial, saving, onClose, onSave, onSubmit, submitting, canEditAfterSubmit = false }) => {
  const [fields, setFields] = useState<FormFields>({
    payee: form.payee || "",
    department: form.department || "",
    date: form.date || "",
    date_needed: form.date_needed || "",
    note: form.note || "",
    prepared_by: form.prepared_by || "",
    checked_by: form.checked_by || "",
    approved_by: form.approved_by || "",
    total_amount_due: form.total_amount_due,
  });

  const readOnly = !!form.submitted && !canEditAfterSubmit;

  return (
    <div>
      {form.submitted && (
        <div className="alert alert-success py-2 px-3 mb-3 d-flex align-items-center gap-2" style={{ fontSize: "0.85rem" }}>
          <i className="bi bi-check-circle-fill"></i>
          <span>
            Submitted{form.submitted_by_name ? ` by ${form.submitted_by_name}` : ""}
            {form.submitted_at ? ` on ${new Date(form.submitted_at).toLocaleString()}` : ""}.
            {readOnly ? " This form can no longer be edited — only AP Officer can." : " You can still edit this submitted form."}
          </span>
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-6">
          <label className="form-label">Payee</label>
          <input disabled={readOnly} className="form-control" style={{ textTransform: "uppercase" }} value={fields.payee} onChange={(e) => setFields({ ...fields, payee: e.target.value })} />
        </div>
        <div className="col-6">
          <label className="form-label">Department</label>
          <input disabled={readOnly} className="form-control" value={fields.department} onChange={(e) => setFields({ ...fields, department: e.target.value })} />
        </div>
        <div className="col-6">
          <label className="form-label">Date</label>
          <input disabled={readOnly} type="date" className="form-control" value={fields.date} onChange={(e) => setFields({ ...fields, date: e.target.value })} />
        </div>
        <div className="col-6">
          <label className="form-label">Date Needed</label>
          <input disabled={readOnly} type="date" className="form-control" value={fields.date_needed} onChange={(e) => setFields({ ...fields, date_needed: e.target.value })} />
        </div>
      </div>

      <label className="form-label fw-semibold">Particulars</label>
      <table className="table table-sm table-bordered mb-2">
        <thead>
          <tr>
            <th>Particulars</th>
            <th style={{ width: "80px" }} className="text-center">Qty</th>
            <th style={{ width: "80px" }} className="text-center">UoM</th>
            <th style={{ width: "140px" }} className="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          {form.particulars.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-muted">No items routed as Payment Request yet.</td>
            </tr>
          ) : (
            form.particulars.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td className="text-center">{line.quantity ?? ""}</td>
                <td className="text-center">{line.uom ?? ""}</td>
                <td className="text-end">{line.amount ? Number(line.amount).toFixed(2) : "0.00"}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-end fw-bold" colSpan={3}>Total Amount Due:</td>
            <td className="text-end p-1">
              <input
                disabled={readOnly}
                type="number"
                min="0"
                step="0.01"
                className="form-control form-control-sm text-end fw-bold"
                value={fields.total_amount_due}
                onChange={(e) => setFields({ ...fields, total_amount_due: e.target.value })}
              />
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="mb-3">
        <label className="form-label">Note</label>
        <textarea disabled={readOnly} className="form-control" rows={2} value={fields.note} onChange={(e) => setFields({ ...fields, note: e.target.value })} />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-4">
          <label className="form-label">Prepared By</label>
          {/* Always the Purchaser who filled out this form — not manually
              editable, see getPaymentRequestForm's own default. */}
          <input disabled className="form-control" value={fields.prepared_by} readOnly />
        </div>
        <div className="col-4">
          <label className="form-label">Checked By</label>
          {/* Always the Stockroom/Custodian reviewer who approved this
              request — not manually editable, see getPaymentRequestForm's
              own default. */}
          <input disabled className="form-control" value={fields.checked_by} readOnly />
        </div>
        <div className="col-4">
          <label className="form-label">Approved By</label>
          {/* Defaults to the Supervisor/Manager who approved this request,
              but stays editable — the only one of the three that is. */}
          <input disabled={readOnly} className="form-control" value={fields.approved_by} onChange={(e) => setFields({ ...fields, approved_by: e.target.value })} />
        </div>
      </div>

      <div className="d-flex justify-content-end gap-2">
        <button
          className="btn btn-outline-secondary"
          onClick={async () => {
            const { printPaymentRequestForm } = await import("@/features/requests/utils/printPaymentRequestForm");
            printPaymentRequestForm({ ...form, ...fields }, requestSerial);
          }}
        >
          <i className="bi bi-printer me-1"></i>Print
        </button>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        {!readOnly && (
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(fields)}>
            {saving ? "Saving..." : "Save"}
          </button>
        )}
        {!form.submitted && onSubmit && (
          <button
            className="btn btn-success"
            disabled={saving || submitting || !form.created_at}
            title={!form.created_at ? "Save the form before submitting it" : undefined}
            onClick={() => {
              if (window.confirm("Submit this Payment Request Form? Once submitted, you will no longer be able to edit it.")) {
                onSubmit();
              }
            }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
};

export default PaymentRequestFormFields;
