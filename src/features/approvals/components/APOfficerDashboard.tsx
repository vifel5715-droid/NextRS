import React, { useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import Layout from "@/components/layout/Layout";
import DeleteReasonModal from "@/components/dialogs/DeleteReasonModal";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { getBsStatusBadgeClass, formatStatusLabel } from "@/lib/utils/status";
import { sanitizeUserInput } from "@/lib/utils/sanitize";
import ApprovalStatusPanel from "@/features/requests/components/ApprovalStatusPanel";
import ReimbursementAttachmentLink from "@/features/requests/components/ReimbursementAttachmentLink";
import { useReimbursementRequests } from "@/features/requests/hooks/useReimbursementRequests";
import { createLogger } from "@/lib/client-logger";
import { formatMilitaryDateTime } from "@/lib/utils/format";
import styles from "@/styles/Dashboard.module.css";

const log = createLogger("APOfficerDashboard");

/**
 * AP Officer Dashboard — the Reimbursement Request workflow's third and
 * final approval stage. Lists only requests Purchaser has already approved;
 * anything still pending or declined earlier in the chain isn't AP's
 * concern yet. There's no further classification step here (Supplier and
 * every item's Amount were fixed at submission) — just a formal Approve/
 * Decline, same as Purchaser's own stage.
 */
const APOfficerDashboard: React.FC = () => {
  const { user } = useAuth();
  // Operations Manager can see this page (cross-cutting approval
  // visibility) but AP's approval/close stays AP Officer's alone — same
  // read-only treatment as CustodianDashboard's Director gate.
  const isReadOnlyRole = user?.role?.toLowerCase().trim() === "operations_manager";
  const {
    reimbursementRequests,
    loadingReimbursementRequests,
    expandedReimbursementIds,
    toggleReimbursementRow,
    reviewReimbursementAsAPOfficer,
    closeReimbursementRequest,
  } = useReimbursementRequests();

  const [declineTarget, setDeclineTarget] = useState<number | null>(null);

  const approvedRequests = reimbursementRequests.filter((r) => r.purchaser_status === "approved");

  // Search + Date Range — same shared toolbar pattern as every other list
  // page (see DateRangeFilter's ARCH note: the date range is app-wide, tied
  // to sidebar badge counts too).
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");

  const requestsInRange = useMemo(
    () => filterByDateRange(approvedRequests, startDate, endDate, "created_at"),
    [approvedRequests, startDate, endDate]
  );

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return requestsInRange;
    return requestsInRange.filter((row) =>
      row.serial.toLowerCase().includes(q) ||
      row.department.toLowerCase().includes(q) ||
      row.supplier.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      (row.requested_by || "").toLowerCase().includes(q)
    );
  }, [requestsInRange, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      "ap-officer-reimbursement-requests",
      [
        { key: "serial", label: "Serial" },
        { key: "created_at", label: "Date Created" },
        { key: "department", label: "Department" },
        { key: "requested_by", label: "Requested By" },
        { key: "supplier", label: "Supplier" },
        { key: "purpose", label: "Purpose" },
        { key: "total_cost", label: "Total Amount" },
        { key: "ap_status_label", label: "Status" },
      ],
      filteredRequests.map((row) => ({
        serial: row.serial,
        created_at: formatMilitaryDateTime(row.created_at),
        department: row.department,
        requested_by: row.requested_by || "",
        supplier: row.supplier,
        purpose: row.purpose,
        total_cost: Number(row.total_cost).toFixed(2),
        ap_status_label: formatStatusLabel(row.ap_status),
      }))
    );

  log.info("Rendering — purchaser-approved reimbursement requests:", approvedRequests.length);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Reimbursement Requests</h1>
        <p className="page-subtitle">Purchaser-Approved Reimbursement Requests</p>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by Serial, Department, Supplier, Purpose, or Requested By..."
        onExport={handleExport}
        exportDisabled={filteredRequests.length === 0}
      />
      <div className="mb-4">
        <DateRangeFilter />
      </div>

      <div className={styles.requestListFrame}>
        <div className={`${styles.urgentListHeader} ${styles.urgentListHeaderAmount}`}>
          <div></div>
          <div>Serial Number</div>
          <div>Created Date</div>
          <div>Department</div>
          <div>Supplier</div>
          <div>Total Amount</div>
          <div>Status</div>
        </div>

        <div>
          {loadingReimbursementRequests && <div className="p-3 text-muted">Loading reimbursement requests...</div>}
          {!loadingReimbursementRequests && approvedRequests.length === 0 && (
            <div className="p-3 text-muted">No Purchaser-approved reimbursement requests yet.</div>
          )}
          {!loadingReimbursementRequests && approvedRequests.length > 0 && filteredRequests.length === 0 && (
            <div className="p-3 text-muted">No reimbursement requests match your search and filters.</div>
          )}
          {filteredRequests.map((row) => {
            const expanded = expandedReimbursementIds.has(row.id);
            return (
              <div key={row.id} className={styles.requestCard}>
                <div
                  className={`${styles.urgentListRow} ${styles.urgentListRowAmount} ${expanded ? styles.urgentListRowExpanded : ""}`}
                  onClick={() => toggleReimbursementRow(row.id)}
                >
                  <div className="text-center">
                    <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                  </div>
                  <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                  <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                  <div data-label="Dept">{row.department}</div>
                  <div data-label="Supplier">{row.supplier}</div>
                  <div data-label="Total Amount">₱{Number(row.total_cost).toFixed(2)}</div>
                  <div data-label="Status">
                    <span className={`badge ${getBsStatusBadgeClass(row.ap_status)}`}>
                      {formatStatusLabel(row.ap_status)}
                    </span>
                  </div>
                </div>

                <div className={`${styles.expandWrapper} ${expanded ? styles.expandWrapperOpen : ""}`}>
                  <div className={styles.expandInner}>
                    {expanded && (
                      <div className={styles.requestCardBody}>
                        <div className="p-3">
                          {row.requested_by && (
                            <div className="mb-2 small text-muted">Requested by: {row.requested_by}</div>
                          )}
                          {row.date_needed && (
                            <div className="mb-2 small text-muted">Date Needed: {new Date(row.date_needed).toLocaleDateString()}</div>
                          )}
                          {row.remarks && (
                            <div className="mb-2 small text-muted">Remarks: {sanitizeUserInput(row.remarks)}</div>
                          )}
                          <ReimbursementAttachmentLink
                            requestId={row.id}
                            attachmentName={row.attachment_name}
                            attachmentSize={row.attachment_size}
                          />

                          <table className="table table-sm mt-2 mb-3">
                            <thead>
                              <tr>
                                <th>Item Description</th>
                                <th>Quantity</th>
                                <th>UoM</th>
                                <th className="text-end">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item, idx) => (
                                <tr key={item.id ?? idx}>
                                  <td>{item.item_description}</td>
                                  <td>{item.quantity ?? ""}</td>
                                  <td>{item.uom ?? ""}</td>
                                  <td className="text-end">₱{Number(item.amount).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td className="text-end fw-bold" colSpan={3}>Total Cost:</td>
                                <td className="text-end fw-bold">₱{Number(row.total_cost).toFixed(2)}</td>
                              </tr>
                            </tfoot>
                          </table>

                          <ApprovalStatusPanel
                            supervisorLabel="Supervisor And Manager"
                            supervisorStatus={row.supervisor_status}
                            supervisorApprovedByName={row.supervisor_approved_by_name}
                            supervisorApprovedAt={row.supervisor_approved_at}
                            custodianLabel="Purchaser"
                            custodianStatus={row.purchaser_status}
                            custodianApprovedByName={row.purchaser_approved_by_name}
                            custodianApprovedAt={row.purchaser_approved_at}
                            thirdLabel="AP Officer"
                            thirdStatus={row.ap_status}
                            thirdApprovedByName={row.ap_approved_by_name}
                            thirdApprovedAt={row.ap_approved_at}
                            rejectionComment={row.rejection_comment}
                          />

                          {row.ap_status === "pending" && !isReadOnlyRole && (
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => reviewReimbursementAsAPOfficer(row.id, "approved")}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => setDeclineTarget(row.id)}
                              >
                                Decline
                              </button>
                            </div>
                          )}

                          {row.ap_status === "approved" && !isReadOnlyRole && (
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-dark"
                                onClick={() => closeReimbursementRequest(row.id)}
                              >
                                Close (Money Fully Received)
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DeleteReasonModal
        isOpen={declineTarget !== null}
        title="Decline Reimbursement Request"
        onClose={() => setDeclineTarget(null)}
        onConfirm={(reason) => {
          if (declineTarget !== null) reviewReimbursementAsAPOfficer(declineTarget, "rejected", reason);
          setDeclineTarget(null);
        }}
      />
    </Layout>
  );
};

export default APOfficerDashboard;
