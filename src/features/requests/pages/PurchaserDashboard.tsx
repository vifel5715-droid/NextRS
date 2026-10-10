import React, { useMemo, useState } from "react";
import { useAuth } from "@app/providers/AuthProvider";
import Layout from "@shared/components/Layout";
import Modal from "@shared/components/Modal";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { exportToExcel } from "@shared/utils/exportExcel";
import { getBsStatusBadgeClass, formatStatusLabel } from "@shared/utils/status";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import ApprovalStatusPanel from "@features/requests/components/ApprovalStatusPanel";
import ReimbursementAttachmentLink from "@features/requests/components/ReimbursementAttachmentLink";
import PaymentRequestFormFields from "@features/requests/components/PaymentRequestFormFields";
import { useUrgentRequests } from "@features/requests/hooks/useUrgentRequests";
import { useReimbursementRequests } from "@features/requests/hooks/useReimbursementRequests";
import { createLogger } from "@shared/utils/logger";
import { formatMilitaryDateTime } from "@shared/utils/format";
import styles from "./Dashboard.module.css";

const log = createLogger("PurchaserDashboard");

/**
 * Purchaser Dashboard — reviews two workflows, one tab each:
 *
 * - Urgent Requests (Phase 2/3 of the Urgent Request plan): only the ones
 *   Stockroom has already approved (the "Noted by:" stamp), since anything
 *   still pending or declined at Stockroom isn't Purchasing's concern yet.
 *   Each item is routed Purchase Order or Payment Request here (Purchase
 *   Order exits to the existing Purchase Request flow — not built yet;
 *   Payment Request items feed the F-ACC-003 form below, saved to
 *   `payment_request_forms`).
 * - Reimbursement Requests: a simpler, single formal Approve/Decline action
 *   (the second of its three stages, after Supervisor/Manager and before AP
 *   Officer) — Supplier and every item's Amount are already fixed at
 *   submission, so there's no classification step here the way Urgent
 *   Requests has.
 */
const PurchaserDashboard: React.FC = () => {
  const { user } = useAuth();
  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;
  // Operations Manager can see this page (cross-cutting approval
  // visibility) but Purchaser's classification/approval stays Purchaser's
  // alone — same read-only treatment as CustodianDashboard's Director gate.
  const isReadOnlyRole = user?.role?.toLowerCase().trim() === "operations_manager";
  // "Submitted Payment Request" — whoever can reach the AP Officer Dashboard
  // (AP Officer, Operations Manager, admin) can still edit this form past
  // submission; a plain Purchaser can only view it read-only from here on
  // (see PaymentRequestFormFields.tsx's canEditAfterSubmit).
  const canEditPaymentRequestFormAfterSubmit = hasPermission("ap_officer_dashboard");
  const {
    urgentRequests,
    loadingUrgentRequests,
    expandedUrgentIds,
    toggleUrgentRow,
    setItemPurchasingTransaction,
    savingItemTransactionId,
    paymentRequestFormRequestId,
    paymentRequestForm,
    loadingPaymentRequestForm,
    savingPaymentRequestForm,
    openPaymentRequestForm,
    closePaymentRequestForm,
    savePaymentRequestFormFields,
    submitPaymentRequestForm,
    submittingPaymentRequestForm,
  } = useUrgentRequests();
  const {
    reimbursementRequests,
    loadingReimbursementRequests,
    expandedReimbursementIds,
    toggleReimbursementRow,
    reviewReimbursementAsPurchaser,
  } = useReimbursementRequests();

  const [activeTab, setActiveTab] = useState<"urgent" | "reimbursement">("urgent");
  const [reimbursementDeclineTarget, setReimbursementDeclineTarget] = useState<number | null>(null);

  // "not_required" — all-Not-Inventoriable requests skip Stockroom entirely
  // once Supervisor/Manager approves (see server's reviewAsSupervisor) —
  // still Purchasing's concern, just with nothing for Stockroom to have done.
  const approvedRequests = urgentRequests.filter((r) => r.stockroom_status === "approved" || r.stockroom_status === "not_required");
  // Reimbursement Requests reach Purchasing right after Supervisor/Manager —
  // there's no Stockroom stage in this workflow at all.
  const approvedReimbursementRequests = reimbursementRequests.filter((r) => r.supervisor_status === "approved");

  // Search + Date Range — same shared toolbar pattern as every other list
  // page (see DateRangeFilter's ARCH note: the date range is app-wide, tied
  // to sidebar badge counts too). One search box drives whichever tab is
  // active; tab badges reflect the date-range-only count (matching
  // UrgentItemsPage's tile counts) so a stray search term never makes a
  // badge read 0 while work is still sitting there.
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");

  const urgentInRange = useMemo(
    () => filterByDateRange(approvedRequests, startDate, endDate, "created_at"),
    [approvedRequests, startDate, endDate]
  );
  const reimbursementInRange = useMemo(
    () => filterByDateRange(approvedReimbursementRequests, startDate, endDate, "created_at"),
    [approvedReimbursementRequests, startDate, endDate]
  );

  const filteredUrgentRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return urgentInRange;
    return urgentInRange.filter((row) =>
      row.serial.toLowerCase().includes(q) ||
      row.department.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      (row.remarks || "").toLowerCase().includes(q) ||
      (row.requested_by || "").toLowerCase().includes(q)
    );
  }, [urgentInRange, searchQuery]);

  const filteredReimbursementRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reimbursementInRange;
    return reimbursementInRange.filter((row) =>
      row.serial.toLowerCase().includes(q) ||
      row.department.toLowerCase().includes(q) ||
      row.supplier.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      (row.requested_by || "").toLowerCase().includes(q)
    );
  }, [reimbursementInRange, searchQuery]);

  // Whole-request delivery status, distinct from the "Noted By" approval
  // status above. Inventoriable items don't track delivery here yet (see
  // urgentRequestItems.delivery_status's ARCH note — that's a later phase),
  // so only Not Inventoriable items count: "Delivered" once every one of
  // them is delivered, "Pending" otherwise (including partial, and requests
  // with no Not Inventoriable items to begin with).
  const getDeliveryStatusLabel = (row: (typeof urgentRequests)[number]): "Pending" | "Delivered" => {
    const trackedItems = row.items.filter((i) => !i.is_inventoriable);
    return trackedItems.length > 0 && trackedItems.every((i) => i.delivery_status === "delivered") ? "Delivered" : "Pending";
  };

  const handleExport = () =>
    activeTab === "urgent"
      ? exportToExcel(
          "purchaser-urgent-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "created_at", label: "Date Created" },
            { key: "department", label: "Department" },
            { key: "requested_by", label: "Requested By" },
            { key: "purpose", label: "Purpose" },
            { key: "remarks", label: "Remarks" },
            { key: "stockroom_status_label", label: "Noted By (Stockroom)" },
            { key: "delivery_status_label", label: "Delivery Status" },
          ],
          filteredUrgentRequests.map((row) => ({
            serial: row.serial,
            created_at: formatMilitaryDateTime(row.created_at),
            department: row.department,
            requested_by: row.requested_by || "",
            purpose: row.purpose,
            remarks: row.remarks || "",
            stockroom_status_label: formatStatusLabel(row.stockroom_status),
            delivery_status_label: getDeliveryStatusLabel(row),
          }))
        )
      : exportToExcel(
          "purchaser-reimbursement-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "created_at", label: "Date Created" },
            { key: "department", label: "Department" },
            { key: "requested_by", label: "Requested By" },
            { key: "supplier", label: "Supplier" },
            { key: "purpose", label: "Purpose" },
            { key: "total_cost", label: "Total Amount" },
            { key: "purchaser_status_label", label: "Status" },
          ],
          filteredReimbursementRequests.map((row) => ({
            serial: row.serial,
            created_at: formatMilitaryDateTime(row.created_at),
            department: row.department,
            requested_by: row.requested_by || "",
            supplier: row.supplier,
            purpose: row.purpose,
            total_cost: Number(row.total_cost).toFixed(2),
            purchaser_status_label: formatStatusLabel(row.purchaser_status),
          }))
        );

  log.info("Rendering — approved urgent requests:", approvedRequests.length, "approved reimbursement requests:", approvedReimbursementRequests.length);

  // Inline per-item transaction editor — one row editable at a time.
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [draftTransaction, setDraftTransaction] = useState<"" | "purchase_order" | "payment_request">("");
  const [draftAmount, setDraftAmount] = useState("");

  const startEditingItem = (item: { id?: number; purchasing_transaction?: string | null; amount?: string | null }) => {
    if (!item.id) return;
    setEditingItemId(item.id);
    setDraftTransaction((item.purchasing_transaction as "purchase_order" | "payment_request" | undefined) || "");
    setDraftAmount(item.amount || "");
  };

  const cancelEditingItem = () => {
    setEditingItemId(null);
    setDraftTransaction("");
    setDraftAmount("");
  };

  const saveEditingItem = async (requestId: number) => {
    if (!editingItemId || !draftTransaction) return;
    if (draftTransaction === "payment_request" && (!draftAmount || Number(draftAmount) < 0)) {
      alert("Enter a valid amount for a Payment Request item.");
      return;
    }
    const ok = await setItemPurchasingTransaction(
      requestId,
      editingItemId,
      draftTransaction,
      draftTransaction === "payment_request" ? Number(draftAmount) : undefined
    );
    if (ok) cancelEditingItem();
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Purchaser Dashboard</h1>
        <p className="page-subtitle">{activeTab === "urgent" ? "Stockroom-Approved Urgent Requests" : "Supervisor-Approved Reimbursement Requests"}</p>
      </div>

      <div className="dash-tabs mb-4">
        <button
          className={`dash-tab ${activeTab === "urgent" ? "active" : ""}`}
          onClick={() => setActiveTab("urgent")}
        >
          Urgent Requests
          <span className="dash-tab-badge">{approvedRequests.length}</span>
        </button>
        <button
          className={`dash-tab ${activeTab === "reimbursement" ? "active" : ""}`}
          onClick={() => setActiveTab("reimbursement")}
        >
          Reimbursement Requests
          <span className="dash-tab-badge">{approvedReimbursementRequests.filter((r) => r.purchaser_status === "pending").length}</span>
        </button>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={
          activeTab === "urgent"
            ? "Search by Serial, Department, Purpose, Remarks, or Requested By..."
            : "Search by Serial, Department, Supplier, Purpose, or Requested By..."
        }
        onExport={handleExport}
        exportDisabled={activeTab === "urgent" ? filteredUrgentRequests.length === 0 : filteredReimbursementRequests.length === 0}
      />
      <div className="mb-4">
        <DateRangeFilter />
      </div>

      {activeTab === "urgent" && (
      <div className={styles.requestListFrame}>
        <div className={`${styles.urgentListHeader} ${styles.urgentListHeaderRemarks}`}>
          <div></div>
          <div>Serial Number</div>
          <div>Created Date</div>
          <div>Department</div>
          <div>Purpose</div>
          <div>Remarks</div>
          <div>Noted By</div>
          <div>Delivery Status</div>
        </div>

        <div>
          {loadingUrgentRequests && <div className="p-3 text-muted">Loading urgent requests...</div>}
          {!loadingUrgentRequests && approvedRequests.length === 0 && (
            <div className="p-3 text-muted">No Stockroom-approved urgent requests yet.</div>
          )}
          {!loadingUrgentRequests && approvedRequests.length > 0 && filteredUrgentRequests.length === 0 && (
            <div className="p-3 text-muted">No urgent requests match your search and filters.</div>
          )}
          {filteredUrgentRequests.map((row) => {
            const expanded = expandedUrgentIds.has(row.id);
            const hasPaymentRequestItems = row.items.some((i) => i.purchasing_transaction === "payment_request");
            return (
              <div key={row.id} className={styles.requestCard}>
                <div
                  className={`${styles.urgentListRow} ${styles.urgentListRowRemarks} ${expanded ? styles.urgentListRowExpanded : ""}`}
                  onClick={() => toggleUrgentRow(row.id)}
                >
                  <div className="text-center">
                    <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                  </div>
                  <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                  <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                  <div data-label="Dept">{row.department}</div>
                  <div data-label="Purpose">{row.purpose}</div>
                  <div data-label="Remarks">{row.remarks ? sanitizeUserInput(row.remarks) : "—"}</div>
                  <div data-label="Status">
                    <span className={`badge ${getBsStatusBadgeClass(row.stockroom_status)}`}>
                      {formatStatusLabel(row.stockroom_status)}
                    </span>
                  </div>
                  <div data-label="Delivery Status">
                    <span className={`badge ${getDeliveryStatusLabel(row) === "Delivered" ? "bg-success" : "bg-secondary"}`}>
                      {getDeliveryStatusLabel(row)}
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

                          <table className="table table-sm mt-2 mb-3 align-middle">
                            <thead>
                              <tr>
                                <th>Item Description</th>
                                <th>Quantity</th>
                                <th>UoM</th>
                                <th>Inventoriable</th>
                                <th>Transaction Type</th>
                                <th>Delivery Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item, idx) => {
                                const isEditing = editingItemId === item.id;
                                return (
                                  <tr key={item.id ?? idx}>
                                    <td>{item.item_description}</td>
                                    <td>{item.quantity ?? ""}</td>
                                    <td>{item.uom ?? ""}</td>
                                    <td>{item.is_inventoriable ? "Yes" : "No"}</td>
                                    <td>
                                      {isEditing ? (
                                        <div className="d-flex flex-wrap gap-2 align-items-center" onClick={(e) => e.stopPropagation()}>
                                          <select
                                            className="form-select form-select-sm"
                                            style={{ width: "160px" }}
                                            value={draftTransaction}
                                            onChange={(e) => setDraftTransaction(e.target.value as "purchase_order" | "payment_request")}
                                          >
                                            <option value="">Select...</option>
                                            <option value="purchase_order">Purchase Order</option>
                                            <option value="payment_request">Payment Request</option>
                                          </select>
                                          {draftTransaction === "payment_request" && (
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              className="form-control form-control-sm"
                                              style={{ width: "110px" }}
                                              placeholder="Amount"
                                              value={draftAmount}
                                              onChange={(e) => setDraftAmount(e.target.value)}
                                            />
                                          )}
                                          <button
                                            className="btn btn-sm btn-success"
                                            disabled={savingItemTransactionId === item.id}
                                            onClick={() => saveEditingItem(row.id)}
                                          >
                                            Save
                                          </button>
                                          <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditingItem}>
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="d-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                          {item.purchasing_transaction === "payment_request" ? (
                                            <span
                                              className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 fw-semibold"
                                              style={{ backgroundColor: "#f3e8ff", color: "#7c3aed", fontSize: "0.78rem" }}
                                            >
                                              <i className="bi bi-cash-coin"></i>
                                              Payment Request
                                              {item.amount && (
                                                <span className="fw-bold" style={{ color: "#5b21b6" }}>
                                                  ₱{Number(item.amount).toFixed(2)}
                                                </span>
                                              )}
                                            </span>
                                          ) : item.purchasing_transaction === "purchase_order" ? (
                                            <span
                                              className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 fw-semibold"
                                              style={{ backgroundColor: "#dbeafe", color: "#1d4ed8", fontSize: "0.78rem" }}
                                            >
                                              <i className="bi bi-cart-check"></i>
                                              Purchase Order
                                            </span>
                                          ) : (
                                            <span
                                              className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 text-muted"
                                              style={{ backgroundColor: "#f1f5f9", fontSize: "0.78rem" }}
                                            >
                                              <i className="bi bi-dash-circle"></i>
                                              Not Classified
                                            </span>
                                          )}
                                          {!isReadOnlyRole && (
                                            <button
                                              className="btn btn-sm btn-link text-decoration-none p-0"
                                              style={{ fontSize: "0.8rem" }}
                                              onClick={() => startEditingItem(item)}
                                            >
                                              {item.purchasing_transaction ? "Change" : "Set"}
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      {item.is_inventoriable ? (
                                        <span className="text-muted">—</span>
                                      ) : (
                                        <>
                                          <span className={`badge ${item.delivery_status === "delivered" ? "bg-success" : item.delivery_status === "partial_delivered" ? "bg-warning text-dark" : "bg-secondary"}`}>
                                            {item.delivery_status === "delivered" ? "Delivered" : item.delivery_status === "partial_delivered" ? `Partial (${item.quantity_delivered ?? 0})` : "Pending"}
                                          </span>
                                          {item.delivered_by_name && (
                                            <div className="small text-muted mt-1">
                                              {item.delivered_by_name}
                                              {item.delivered_at ? ` — ${new Date(item.delivered_at).toLocaleDateString()}` : ""}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {hasPaymentRequestItems && !isReadOnlyRole && (
                            <div className="mb-3" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => openPaymentRequestForm(row.id)}
                              >
                                <i className="bi bi-file-earmark-text me-1"></i>
                                Payment Request Form
                              </button>
                            </div>
                          )}

                          <ApprovalStatusPanel
                            supervisorLabel="Supervisor And Manager"
                            supervisorStatus={row.supervisor_status}
                            supervisorApprovedByName={row.supervisor_approved_by_name}
                            supervisorApprovedAt={row.supervisor_approved_at}
                            custodianLabel="Stockroom"
                            custodianStatus={row.stockroom_status}
                            custodianApprovedByName={row.stockroom_approved_by_name}
                            custodianApprovedAt={row.stockroom_approved_at}
                            rejectionComment={row.rejection_comment}
                          />
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
      )}

      {activeTab === "reimbursement" && (
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
          {!loadingReimbursementRequests && approvedReimbursementRequests.length === 0 && (
            <div className="p-3 text-muted">No Supervisor-approved reimbursement requests yet.</div>
          )}
          {!loadingReimbursementRequests && approvedReimbursementRequests.length > 0 && filteredReimbursementRequests.length === 0 && (
            <div className="p-3 text-muted">No reimbursement requests match your search and filters.</div>
          )}
          {filteredReimbursementRequests.map((row) => {
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
                    <span className={`badge ${getBsStatusBadgeClass(row.purchaser_status)}`}>
                      {formatStatusLabel(row.purchaser_status)}
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

                          {row.purchaser_status === "pending" && !isReadOnlyRole && (
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => reviewReimbursementAsPurchaser(row.id, "approved")}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => setReimbursementDeclineTarget(row.id)}
                              >
                                Decline
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
      )}

      <Modal
        isOpen={paymentRequestFormRequestId !== null}
        onClose={closePaymentRequestForm}
        title="Payment Request — F-ACC-003"
      >
        {loadingPaymentRequestForm || !paymentRequestForm ? (
          <div className="p-3 text-muted">Loading...</div>
        ) : (
          <PaymentRequestFormFields
            key={paymentRequestForm.urgent_request_id}
            form={paymentRequestForm}
            requestSerial={approvedRequests.find((r) => r.id === paymentRequestFormRequestId)?.serial ?? ""}
            saving={savingPaymentRequestForm}
            submitting={submittingPaymentRequestForm}
            canEditAfterSubmit={canEditPaymentRequestFormAfterSubmit}
            onClose={closePaymentRequestForm}
            onSave={(fields) => {
              if (paymentRequestFormRequestId !== null) {
                savePaymentRequestFormFields(paymentRequestFormRequestId, {
                  ...fields,
                  total_amount_due: fields.total_amount_due !== "" ? Number(fields.total_amount_due) : undefined,
                });
              }
            }}
            onSubmit={() => {
              if (paymentRequestFormRequestId !== null) submitPaymentRequestForm(paymentRequestFormRequestId);
            }}
          />
        )}
      </Modal>

      <DeleteReasonModal
        isOpen={reimbursementDeclineTarget !== null}
        title="Decline Reimbursement Request"
        onClose={() => setReimbursementDeclineTarget(null)}
        onConfirm={(reason) => {
          if (reimbursementDeclineTarget !== null) reviewReimbursementAsPurchaser(reimbursementDeclineTarget, "rejected", reason);
          setReimbursementDeclineTarget(null);
        }}
      />
    </Layout>
  );
};

export default PurchaserDashboard;
