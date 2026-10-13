import React, { useCallback, useEffect, useState } from "react";
import Modal from "@/components/dialogs/Modal";
import { adjustmentLogAPI, type AdjustmentLogEntry } from "@/lib/api";
import { sanitizeUserInput } from "@/lib/utils/sanitize";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { printAdjustmentHistory } from "@/features/reports/utils/adjustmentSlip";
import { formatMilitaryDateTime } from "@/lib/utils/format";

interface AdjustmentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: number | null;
  /** item_requests.id, service_requests.id, and petty_cash_transactions.id
   * are independent sequences that can land on the same number, so the type
   * has to travel with the id to fetch the right request's history — see
   * adjustment_log.request_type. */
  requestType?: "item" | "service" | "petty_cash";
}

/** History of corrections made to one request's lines (Item Name/Quantity/
 * UoM/Remarks/Machine Code for an item request, Description for a service
 * request). Fetches fresh on every open rather than caching, since a save
 * elsewhere can add to it at any time. */
const AdjustmentHistoryModal: React.FC<AdjustmentHistoryModalProps> = ({ isOpen, onClose, requestId, requestType = "item" }) => {
  const [entries, setEntries] = useState<AdjustmentLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Async, and every state update sits after the `await` — see useDeletionLog
  // for the same shape. A synchronous setState reachable from the effect body
  // (even indirectly) trips the set-state-in-effect lint rule.
  const fetchEntries = useCallback(async (id: number, type: "item" | "service" | "petty_cash") => {
    try {
      const res = await adjustmentLogAPI.getForRequest(id, type);
      setEntries(res.data);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load adjustment history"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || requestId === null) return;
    fetchEntries(requestId, requestType);
  }, [isOpen, requestId, requestType, fetchEntries]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Adjustment History">
      {isLoading ? (
        <div className="text-center py-4 text-muted">Loading…</div>
      ) : error ? (
        <div className="text-danger py-2">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-4 text-muted">No adjustments recorded for this request.</div>
      ) : (
        <>
          <div className="d-flex justify-content-end mb-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => printAdjustmentHistory(entries, entries[0]?.request_serial)}
            >
              <i className="bi bi-printer me-1"></i>Print to PDF
            </button>
          </div>
          <div className="table-responsive">
            {/* simple-list-table collapses each row into a labeled stacked
                card below 768px (see globals.css) instead of letting this wide
                table overflow off the side of a phone screen — same
                technique AdjustmentHistoryPage.tsx's full-page table uses. */}
            <table className="table table-sm simple-list-table" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
              <thead style={{ backgroundColor: "#f8f9fa" }}>
                <tr>
                  {["Adjustment No.", "Serial", "Date & Time", "Department", "Item", "Field", "Before", "After", "Remarks", "Adjusted By"].map((h) => (
                    <th key={h} style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: 600, color: "#495057", fontSize: "0.8rem" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa" }}>
                    <td data-label="Adjustment No." style={{ padding: "10px", border: "none", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {sanitizeUserInput(entry.adjustment_serial || "—")}
                    </td>
                    <td data-label="Serial" style={{ padding: "10px", border: "none", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {sanitizeUserInput(entry.request_serial)}
                    </td>
                    <td data-label="Date & Time" style={{ padding: "10px", border: "none", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {formatMilitaryDateTime(entry.adjusted_at)}
                    </td>
                    <td data-label="Department" style={{ padding: "10px", border: "none", fontSize: "0.8rem" }}>{sanitizeUserInput(entry.adjusted_by_department)}</td>
                    <td data-label="Item" style={{ padding: "10px", border: "none", fontSize: "0.8rem" }}>{sanitizeUserInput(entry.item_label)}</td>
                    <td data-label="Field" style={{ padding: "10px", border: "none", fontSize: "0.8rem" }}>{sanitizeUserInput(entry.field)}</td>
                    <td data-label="Before" style={{ padding: "10px", border: "none", fontSize: "0.8rem", color: "#b91c1c" }}>{sanitizeUserInput(entry.before_value || "N/A")}</td>
                    <td data-label="After" style={{ padding: "10px", border: "none", fontSize: "0.8rem", color: "#15803d" }}>{sanitizeUserInput(entry.after_value || "N/A")}</td>
                    <td data-label="Remarks" style={{ padding: "10px", border: "none", fontSize: "0.8rem" }}>{sanitizeUserInput(entry.adjustment_remarks || "—")}</td>
                    <td data-label="Adjusted By" style={{ padding: "10px", border: "none", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {sanitizeUserInput(entry.adjusted_by_name)} <span className="text-muted">({sanitizeUserInput(entry.adjusted_by_role)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};

export default AdjustmentHistoryModal;
