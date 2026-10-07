import { formatMilitaryTime } from "@shared/utils/format";
import type { ItemAudit } from "@shared/types";

/**
 * Issuance history for a request item, split into the three transaction types
 * it records. They are deliberately separate tables: a release, a completing
 * delivery, and a still-incomplete partial arrival are different events.
 *   - Qty Out       — quantity released to the requester, with its issuance number.
 *   - Full Delivery    — the delivery that brought the item to fully delivered.
 *   - Partial Delivery — quantity that arrived in an incomplete delivery.
 * Each column shows the amount moved by its own transaction. The running
 * remainder is still recorded per row as `remaining_balance` if it is ever needed.
 */
const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: "600",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "#6c757d",
  textAlign: "center",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "separate",
  borderSpacing: "0",
  border: "2px solid #adb5bd",
  borderRadius: "6px",
  overflow: "hidden",
  backgroundColor: "#ffffff",
};

const thStyle: React.CSSProperties = { padding: "12px 16px", border: "none", fontWeight: "600", color: "#495057" };
const tdStyle: React.CSSProperties = { padding: "12px 16px", border: "none", color: "#212529" };
const dateTdStyle: React.CSSProperties = { ...tdStyle, whiteSpace: "nowrap" };

const formatDate = (value: string) => new Date(value).toISOString().split("T")[0];

/** Small × that removes one issuance record. Only rendered when a handler is given. */
const DeleteCell = ({ auditId, onDelete }: { auditId: number; onDelete: (id: number) => void }) => (
  <td style={{ ...tdStyle, width: "36px", textAlign: "center" }}>
    <button
      type="button"
      className="btn btn-sm btn-link p-0 text-danger"
      style={{ lineHeight: 1, fontSize: "1rem", textDecoration: "none" }}
      title="Delete this issuance record"
      onClick={() => onDelete(auditId)}
    >
      &times;
    </button>
  </td>
);

export default function IssuanceHistory({
  audits,
  onDelete,
  prNumber,
  prNumberLabel = "PR Number",
  showPrNumber = true,
}: {
  audits: ItemAudit[];
  onDelete?: (auditId: number) => void;
  /** Item-level PR/GR number — one per item, not per delivery, so it's repeated on every row. */
  prNumber?: string | null;
  prNumberLabel?: string;
  /** Procurement detail — only custodian/admin should see it, not the requester-side roles. */
  showPrNumber?: boolean;
}) {
  const outAudits = audits.filter((a) => a.transaction_type === "OUT");
  const fullAudits = audits.filter((a) => a.transaction_type === "FULL");
  const partialAudits = audits.filter((a) => a.transaction_type === "PARTIAL");

  return (
    <div className="table-responsive">
      {outAudits.length > 0 && (
        <>
          <div style={{ ...labelStyle, padding: "4px 0" }}>Qty Out</div>
          <table className="table table-sm mb-0" style={tableStyle}>
            <thead style={{ backgroundColor: "#f1f3f5" }}>
              <tr>
                <th style={thStyle}>Issuance No.</th>
                <th style={thStyle}>Qty Out</th>
                <th style={thStyle}>Custodian</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Time</th>
                {onDelete && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {outAudits.map((audit, i) => (
                <tr key={audit.id} style={{ borderBottom: i < outAudits.length - 1 ? "2px solid #adb5bd" : "none" }}>
                  <td style={tdStyle}>{audit.issuance_number || "-"}</td>
                  <td style={tdStyle}>{audit.quantity_issued}</td>
                  <td style={tdStyle}>{audit.custodian_name}</td>
                  <td style={dateTdStyle}>{formatDate(audit.issued_at)}</td>
                  <td style={dateTdStyle}>{formatMilitaryTime(audit.issued_at)}</td>
                  {onDelete && <DeleteCell auditId={audit.id} onDelete={onDelete} />}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* The delivery that completed the item — in one shot or as the last of
          several partials — split out from the still-incomplete partials
          below so "who actually received the full item" is unambiguous. */}
      {fullAudits.length > 0 && (
        <>
          <div style={{ ...labelStyle, padding: "12px 0 4px" }}>Full Delivery</div>
          <table className="table table-sm mb-0" style={tableStyle}>
            <thead style={{ backgroundColor: "#f1f3f5" }}>
              <tr>
                {showPrNumber && <th style={thStyle}>{prNumberLabel}</th>}
                <th style={thStyle}>Qty Received</th>
                <th style={thStyle}>Custodian</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Time</th>
                {onDelete && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {fullAudits.map((audit) => (
                <tr key={audit.id} style={{ borderBottom: "none" }}>
                  {showPrNumber && <td style={tdStyle}>{prNumber || "-"}</td>}
                  <td style={tdStyle}>{audit.quantity_issued}</td>
                  <td style={tdStyle}>{audit.custodian_name}</td>
                  <td style={dateTdStyle}>{formatDate(audit.issued_at)}</td>
                  <td style={dateTdStyle}>{formatMilitaryTime(audit.issued_at)}</td>
                  {onDelete && <DeleteCell auditId={audit.id} onDelete={onDelete} />}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Only shown when the item actually went through partial deliveries — a
          direct OUT release has no pending-arrival history to report. */}
      {partialAudits.length > 0 && (
        <>
          <div style={{ ...labelStyle, padding: "12px 0 4px" }}>Partial Delivery</div>
          <table className="table table-sm mb-0" style={tableStyle}>
            <thead style={{ backgroundColor: "#f1f3f5" }}>
              <tr>
                <th style={thStyle}>Partial Qty</th>
                <th style={thStyle}>Custodian</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Time</th>
                {onDelete && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {partialAudits.map((audit, i) => (
                <tr key={audit.id} style={{ borderBottom: i < partialAudits.length - 1 ? "2px solid #adb5bd" : "none" }}>
                  <td style={tdStyle}>{audit.quantity_issued}</td>
                  <td style={tdStyle}>{audit.custodian_name}</td>
                  <td style={dateTdStyle}>{formatDate(audit.issued_at)}</td>
                  <td style={dateTdStyle}>{formatMilitaryTime(audit.issued_at)}</td>
                  {onDelete && <DeleteCell auditId={audit.id} onDelete={onDelete} />}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
