import React, { useEffect } from "react";
import Layout from "@shared/components/Layout";
import Modal from "@shared/components/Modal";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import ApprovalStatusPanel from "@features/requests/components/ApprovalStatusPanel";
import ReimbursementAttachmentLink from "@features/requests/components/ReimbursementAttachmentLink";
import { useAuth } from "@app/providers/AuthProvider";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import { getBsStatusBadgeClass, formatStatusLabel, getItemStatusText, getItemStatusBadgeClass, getHeldServiceCount, hasEditedHeldService } from "@shared/utils/status";
import { useSupervisorRequests } from "@features/requests/hooks/useSupervisorRequests";
import { useUrgentRequests } from "@features/requests/hooks/useUrgentRequests";
import { useReimbursementRequests } from "@features/requests/hooks/useReimbursementRequests";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { makeRequestKey } from "@shared/utils/requestKey";
import { createLogger } from "@shared/utils/logger";
import IssuanceHistory from "@features/requests/components/IssuanceHistory";
import { ItemExistenceBadge } from "@shared/components/ItemExistenceStatus";
import { useItemCatalogNames } from "@features/item-catalog/hooks/useItemCatalogNames";
import { getItemExistenceStatus } from "@shared/utils/itemExistenceStatus";
import { getItemBalance } from "@shared/utils/itemBalance";
import { formatMilitaryTime, formatMilitaryDateTime } from "@shared/utils/format";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import type { ItemRow, ServiceRow } from "@shared/types";
import styles from "./Dashboard.module.css";

const log = createLogger("SupervisorDashboard");

const tabClass = (active: boolean) => `dash-tab ${active ? "active" : ""}`;

const formatDateOrNull = (date?: string | null): string | null =>
  date ? new Date(date).toLocaleDateString() : null;

/** Makes a clickable row div keyboard-accessible (Enter/Space toggles it). */
const toggleRowProps = (expanded: boolean, onToggle: () => void) => ({
  role: "button",
  tabIndex: 0,
  "aria-expanded": expanded,
  onClick: onToggle,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  },
});

interface HoldStatusBadgeProps {
  status?: string;
  hasHeldItem: boolean;
  heldItemEdited: boolean;
  heldItemCount?: number;
  services?: ServiceRow[];
}

// Display-only — a Held item never touches the underlying `status`, so this
// overlays "ON HOLD"/"RELEASE ON HOLD" without disturbing the real
// supervisor/custodian approval shown once expanded. A rejected request stays
// "rejected" even with a stale HOLD item.
const HoldStatusBadge: React.FC<HoldStatusBadgeProps> = ({ status, hasHeldItem, heldItemEdited, heldItemCount, services }) => {
  if (status !== "rejected") {
    if (hasHeldItem) {
      return (
        <span className="badge bg-danger">
          {heldItemEdited ? "RELEASE ON HOLD" : "ON HOLD"}{heldItemCount ? ` (${heldItemCount})` : ""}
        </span>
      );
    }
    const heldServiceCount = getHeldServiceCount({ services });
    if (heldServiceCount > 0) {
      return (
        <span className="badge bg-danger">
          {hasEditedHeldService({ services }) ? "RELEASE ON HOLD" : "ON HOLD"}
          {` (${heldServiceCount})`}
        </span>
      );
    }
  }
  return <span className={`badge ${getBsStatusBadgeClass(status)}`}>{formatStatusLabel(status)}</span>;
};

const ApprovalAction: React.FC<{ evaluated: boolean; canApprove: boolean; onProcess: () => void }> = ({ evaluated, canApprove, onProcess }) => {
  if (evaluated) return <span className="badge bg-secondary">Already Evaluated</span>;
  if (!canApprove) return <span className="badge bg-secondary">Awaiting manager approval</span>;
  return (
    <button onClick={onProcess} className="btn btn-sm btn-primary w-100">
      <i className="bi bi-check2-circle me-1"></i>Process Approval
    </button>
  );
};

const getUrgentDeliveryBadge = (deliveryStatus?: string | null, quantityDelivered?: number | null) => {
  if (deliveryStatus === "delivered") return { className: "bg-success", label: "Delivered" };
  if (deliveryStatus === "partial_delivered") return { className: "bg-warning text-dark", label: `Partial (${quantityDelivered ?? 0})` };
  return { className: "bg-secondary", label: "Pending" };
};

const ListStatusMessage: React.FC<{ loading: boolean; empty: boolean; loadingText: string; emptyText: string }> = ({ loading, empty, loadingText, emptyText }) => {
  if (loading) return <div className="p-3 text-muted">{loadingText}</div>;
  if (empty) return <div className="p-3 text-muted">{emptyText}</div>;
  return null;
};

const detailLabelCellStyle: React.CSSProperties = { width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" };
const detailValueCellStyle: React.CSSProperties = { padding: "8px 12px", border: "none", color: "#212529" };
const detailRowStyle: React.CSSProperties = { borderBottom: "1px solid #dee2e6" };

// Read-only — delivery, PR, and issuance tracking are custodian actions, not
// supervisor edits. Same data and layout as the other dashboards' Details
// column, so "who received it and when" is visible everywhere the item is.
const ItemDeliveryDetails: React.FC<{ item: ItemRow; showPrNumber: boolean }> = ({ item, showPrNumber }) => {
  if (!item.delivery_status) return <span className="text-muted">-</span>;
  const isPrOrUrgent = item.delivery_status === "PURCHASE REQUEST" || item.delivery_status === "URGENT";
  const isUrgent = item.delivery_status === "URGENT";
  const historyIsUrgent = (item.pr_type || item.delivery_status) === "URGENT";
  const showQtyDelivered = item.delivery_status === "PARTIAL DELIVERED" || (isPrOrUrgent && item.pr_status === "DELIVERED PARTIAL");
  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #dee2e6", borderRadius: "6px", overflow: "hidden", backgroundColor: "#fafbfc" }}>
        <tbody>
          {item.delivery_status === "OUT" && (
            <>
              <tr style={detailRowStyle}>
                <td style={detailLabelCellStyle}>Issuance No.</td>
                <td style={detailValueCellStyle}>{item.issuance_number || "Not issued yet"}</td>
              </tr>
              <tr style={detailRowStyle}>
                <td style={detailLabelCellStyle}>Qty Out</td>
                <td style={detailValueCellStyle}>{item.quantity_out ?? 0} / {item.quantity}</td>
              </tr>
            </>
          )}
          {isPrOrUrgent && (
            <tr style={detailRowStyle}>
              <td style={detailLabelCellStyle}>{isUrgent ? "Date Needed" : "PR Number"}</td>
              <td style={detailValueCellStyle}>{(isUrgent ? formatDateOrNull(item.date_needed) : item.pr_number) || "N/A"}</td>
            </tr>
          )}
          {isPrOrUrgent && item.pr_status && (
            <tr style={detailRowStyle}>
              <td style={detailLabelCellStyle}>Order Status</td>
              <td style={detailValueCellStyle}>{item.pr_status}</td>
            </tr>
          )}
          {item.audits && item.audits.length > 0 && (
            <tr>
              <td colSpan={2} style={{ padding: "0", border: "none" }}>
                <IssuanceHistory
                  audits={item.audits}
                  prNumber={historyIsUrgent ? formatDateOrNull(item.date_needed) : item.pr_number}
                  prNumberLabel={historyIsUrgent ? "Date Needed" : "PR Number"}
                  showPrNumber={showPrNumber}
                />
              </td>
            </tr>
          )}
          {showQtyDelivered && (
            <tr style={detailRowStyle}>
              <td style={detailLabelCellStyle}>Qty Delivered</td>
              <td style={detailValueCellStyle}>{item.quantity_delivered || "N/A"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const SupervisorDashboard: React.FC = () => {
  const { user } = useAuth();
  const itemCatalogNames = useItemCatalogNames();
  const machineCodeOptions = useMachineCodeOptions();

  const {
    filteredItemRequests,
    filteredServiceRequests,
    itemRequests,
    serviceRequests,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    expandedRows,
    requestDetails,
    editableItems,
    hasChanges,
    selectedRequest,
    showModal,
    newStatus,
    setNewStatus,
    editMode,
    setEditMode,
    editFormData,
    setEditFormData,
    rejectionComment,
    setRejectionComment,
    handleRowClick,
    handleStatusClick,
    handleEdit,
    addItem,
    deleteItem,
    updateItem,
    updateItemList,
    handleStatusUpdate,
    closeModal,
    canApproveRequest,
  } = useSupervisorRequests();

  const { urgentRequests, loadingUrgentRequests, reviewUrgentRequestAsSupervisor, canApproveUrgentAsSupervisor, expandedUrgentIds, toggleUrgentRow } = useUrgentRequests();
  const {
    reimbursementRequests,
    loadingReimbursementRequests,
    reviewReimbursementAsSupervisor,
    canApproveReimbursementAsSupervisor,
    expandedReimbursementIds,
    toggleReimbursementRow,
    reloadReimbursementRequests,
  } = useReimbursementRequests();
  const [activeUrgentTab, setActiveUrgentTab] = React.useState(false);
  const [activeReimbursementTab, setActiveReimbursementTab] = React.useState(false);
  const [urgentDeclineTarget, setUrgentDeclineTarget] = React.useState<number | null>(null);
  const [reimbursementDeclineTarget, setReimbursementDeclineTarget] = React.useState<number | null>(null);

  const isItemTab = activeTab === "item";
  const rows = isItemTab ? filteredItemRequests : filteredServiceRequests;
  const totalCount = isItemTab ? itemRequests.length : serviceRequests.length;
  const showRequestTabs = !activeUrgentTab && !activeReimbursementTab;
  const isAdmin = user?.role?.toLowerCase().trim() === "admin";

  useEffect(() => {
    log.info("Mounted — user:", user?.email, `(${user?.role})`);
    return () => { log.info("Unmounted"); };
  }, [user?.email, user?.role]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Approval Dashboard</h1>
        <p className="page-subtitle">{user?.department} — Pending Approvals</p>
      </div>

      <div className="dash-toolbar">
        <div className="dash-tabs">
          <button
            className={tabClass(showRequestTabs && isItemTab)}
            onClick={() => { log.info("Tab switched to: item"); setActiveUrgentTab(false); setActiveReimbursementTab(false); setActiveTab("item"); }}
          >
            Item Requests<span className="dash-tab-badge">{filteredItemRequests.length}</span>
          </button>
          <button
            className={tabClass(showRequestTabs && !isItemTab)}
            onClick={() => { log.info("Tab switched to: service"); setActiveUrgentTab(false); setActiveReimbursementTab(false); setActiveTab("service"); }}
          >
            Service Requests<span className="dash-tab-badge">{filteredServiceRequests.length}</span>
          </button>
          <button
            className={tabClass(activeUrgentTab)}
            onClick={() => { setActiveReimbursementTab(false); setActiveUrgentTab(true); }}
          >
            Urgent Requests<span className="dash-tab-badge">
              {urgentRequests.filter((r) => r.supervisor_status === "pending").length}
            </span>
          </button>
          <button
            className={tabClass(activeReimbursementTab)}
            onClick={() => { setActiveUrgentTab(false); setActiveReimbursementTab(true); }}
          >
            Reimbursement Requests<span className="dash-tab-badge">
              {reimbursementRequests.filter((r) => r.supervisor_status === "pending").length}
            </span>
          </button>
        </div>
        <div className={styles.searchContainer}>
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control border-start-0"
              placeholder="Search by Serial, Purpose, PR Number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {showRequestTabs && (
      <div className="mb-4">
        <DateRangeFilter />
      </div>
      )}

      {showRequestTabs && (
      <div className={styles.requestListFrame}>
        <div className={styles.requestListHeader}>

          <div>Serial Number</div>
          <div>Created Date</div>
          <div>Created By</div>
          <div>Department</div>
          <div>Purpose</div>
          <div>Status</div>
        </div>
        {totalCount === 0 ? (
          <div className="text-center py-5" style={{ color: "#9ca3af" }}>
            <i className="bi bi-inbox" style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}></i>
            No pending {isItemTab ? "item" : "service"} requests found.
          </div>
        ) : rows.map((row) => {
          const key = makeRequestKey(activeTab, row.id);
          const details = requestDetails.get(key);
          const evaluated = !!(details?.supervisor_status && details.supervisor_status !== "pending");
          const expanded = expandedRows.has(key);
          const heldDetailItems = ((details as { items?: ItemRow[] } | undefined)?.items ?? []).filter((i) => i.delivery_status === "HOLD");
          return (
            <div key={row.id} className={styles.requestCard}>
              <div
                className={`${styles.requestCardRow} ${expanded ? styles.requestCardRowExpanded : ""}`}
                {...toggleRowProps(expanded, () => handleRowClick(row))}
              >
                <div className="text-center">
                  <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                </div>
                <div className="fw-medium" data-label="Serial">{row.serial}</div>
                <div className="text-muted" data-label="Date">{row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : ""}</div>
                <div className="hide-sm" data-label="By">{row.created_by}</div>
                <div className="hide-sm" data-label="Dept">{row.department}</div>
                <div data-label="Purpose">{row.purpose}</div>
                <div>
                  <HoldStatusBadge
                    status={row.status}
                    hasHeldItem={!!row.has_held_item}
                    heldItemEdited={!!row.has_edited_held_item}
                    heldItemCount={row.held_item_count}
                    services={(row as { services?: ServiceRow[] }).services}
                  />
                </div>
              </div>
              <div className={`${styles.expandWrapper} ${expanded ? styles.expandWrapperOpen : ""}`}>
              <div className={styles.expandInner}>
              {details && (
                <div className={styles.requestCardBody}>
                  <div className="p-3">
                    {/* Request Information */}
                    <div className="border rounded p-3 mb-3 bg-light">
                      <div className="fw-semibold text-secondary small text-uppercase mb-3">Request Information</div>
                      <div className="row g-3">
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Serial</div>
                          <div className="fw-semibold">{details.serial}</div>
                        </div>
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Created Time</div>
                          <div className="fw-semibold">{formatMilitaryTime(details.created_at)}</div>
                        </div>
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Department</div>
                          <div className="fw-semibold">{details.department}</div>
                        </div>
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
                          <HoldStatusBadge
                            status={details.status}
                            hasHeldItem={heldDetailItems.length > 0}
                            heldItemEdited={heldDetailItems.some((i) => i.hold_edited)}
                            heldItemCount={heldDetailItems.length}
                            services={details.services}
                          />
                        </div>
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
                          <div>{sanitizeUserInput(details.remarks || "—")}</div>
                        </div>
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
                          <div>{sanitizeUserInput(details.purpose || "—")}</div>
                        </div>
                      </div>
                    </div>
                    {/* Supervisor Status + Action */}
                    <div className="border rounded p-3 mb-3">
                      <div className="fw-semibold text-secondary small text-uppercase mb-3">Approval</div>
                      <div className="row g-2 mb-3">
                        <div className="col-12 col-sm-6">
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>Supervisor and Manager Status</div>
                          <span className={`badge ${getBsStatusBadgeClass(details.supervisor_status)}`}>
                            {formatStatusLabel(details.supervisor_status) || "pending"}
                          </span>
                        </div>
                      </div>
                      <div>
                        <ApprovalAction
                          evaluated={evaluated}
                          canApprove={canApproveRequest(details)}
                          onProcess={() => handleStatusClick(row)}
                        />
                      </div>
                    </div>
                    {isItemTab ? (
                      <>
                        <h5 className="mb-2">Items</h5>
                        <div className="table-responsive">
                          <table className={`table table-sm ${styles.itemsTable}`} style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                            <thead style={{ backgroundColor: "#f8f9fa" }}>
                              <tr>
                                {(["#", "Item Name", "Qty", "UoM", "Remarks", "Machine Code", "Balance", "Existence Status", "Status", "Details", "Action"] as const).map((label) => (
                                  <th key={label} style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>{label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {((editableItems.get(key) || []) as ItemRow[]).map((item: ItemRow, idx: number) => (
                                <tr key={item.id ?? `new-${idx}`} style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                                  <td data-label="#" style={{ padding: "12px", border: "none" }}>{idx + 1}</td>
                                  <td data-label="Item Name" style={{ padding: "12px", border: "none" }}><input type="text" value={item.item_name || ""} className="form-control form-control-sm" onChange={(e) => updateItem(row.id, idx, "item_name", e.target.value)} /></td>
                                  <td data-label="Qty" style={{ padding: "12px", border: "none" }}><input type="number" min="1" value={item.quantity || 1} className="form-control form-control-sm" onChange={(e) => updateItem(row.id, idx, "quantity", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} /></td>
                                  <td data-label="UoM" style={{ padding: "12px", border: "none" }}><input type="text" value={item.uom || ""} className="form-control form-control-sm" onChange={(e) => updateItem(row.id, idx, "uom", e.target.value)} /></td>
                                  <td data-label="Remarks" style={{ padding: "12px", border: "none" }}><input type="text" value={item.remarks || ""} className="form-control form-control-sm" onChange={(e) => updateItem(row.id, idx, "remarks", e.target.value)} /></td>
                                  <td data-label="Machine Code" style={{ padding: "12px", border: "none" }}>
                                    <SearchableCombobox
                                      className="form-control form-control-sm text-uppercase"
                                      value={item.machine_code || ""}
                                      onChange={(value) => updateItem(row.id, idx, "machine_code", value)}
                                      options={machineCodeOptions.options}
                                      descriptions={machineCodeOptions.descriptions}
                                      placeholder="Search or type…"
                                      noResultsText="No record found"
                                    />
                                  </td>
                                  <td data-label="Balance" style={{ padding: "12px", border: "none" }}>
                                    {getItemBalance(item)}
                                  </td>
                                  <td data-label="Existence Status" style={{ padding: "12px", border: "none" }}>
                                    <ItemExistenceBadge status={getItemExistenceStatus(item.item_name, itemCatalogNames)} />
                                  </td>
                                  <td data-label="Status" style={{ padding: "12px", border: "none" }}>
                                    <span className={`badge ${getItemStatusBadgeClass(item)}`}>
                                      {getItemStatusText(item)}
                                    </span>
                                  </td>
                                  <td data-label="Details" style={{ padding: "12px", border: "none" }}>
                                    <ItemDeliveryDetails item={item} showPrNumber={isAdmin} />
                                  </td>
                                  <td data-label="Action" style={{ padding: "12px", border: "none" }} className="text-center">
                                    <button className="btn btn-sm btn-outline-danger" onClick={() => deleteItem(row.id, idx)}>
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="d-flex gap-2 mt-3">
                          <button onClick={() => addItem(row.id)} className="btn btn-sm btn-outline-primary">+ Add Item</button>
                          {hasChanges.get(key) && (
                            <button onClick={() => updateItemList(row.id)} className="btn btn-sm btn-success">Save Changes</button>
                          )}
                        </div>
                      </>
                    ) : (
                      details.services && details.services.length > 0 && (
                        <>
                          <h5 className="mb-2">Services</h5>
                          <div className="table-responsive">
                            <table className={`table table-sm ${styles.itemsTable}`} style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                              <thead style={{ backgroundColor: "#f8f9fa" }}>
                                <tr>
                                  {(["#", "Description"] as const).map((label) => (
                                    <th key={label} style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>{label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(details.services || []).map((service: ServiceRow, idx: number) => (
                                  <tr key={service.id ?? idx} style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                                    <td data-label="#" style={{ padding: "12px", border: "none" }}>{idx + 1}</td>
                                    <td data-label="Description" style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(service.description || "")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )
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
      )}

      {activeUrgentTab && (
        <div className={styles.requestListFrame}>
          <div className={styles.urgentListHeader}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Department</div>
            <div>Purpose</div>
            <div>Status</div>
          </div>

          <div>
            <ListStatusMessage loading={loadingUrgentRequests} empty={urgentRequests.length === 0} loadingText="Loading urgent requests..." emptyText="No urgent requests." />
            {urgentRequests.map((row) => {
              const expanded = expandedUrgentIds.has(row.id);
              return (
                <div key={row.id} className={styles.requestCard}>
                  <div
                    className={`${styles.urgentListRow} ${expanded ? styles.urgentListRowExpanded : ""}`}
                    {...toggleRowProps(expanded, () => toggleUrgentRow(row.id))}
                  >
                    <div className="text-center">
                      <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                    </div>
                    <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                    <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                    <div data-label="Dept">{row.department}</div>
                    <div data-label="Purpose">{row.purpose}</div>
                    <div data-label="Status">
                      <span className={`badge ${getBsStatusBadgeClass(row.supervisor_status)}`}>
                        {formatStatusLabel(row.supervisor_status)}
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
                            <table className="table table-sm mt-2 mb-3">
                              <thead>
                                <tr>
                                  <th>Item Description</th>
                                  <th>Quantity</th>
                                  <th>UoM</th>
                                  <th>Inventoriable</th>
                                  <th>Delivery Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item, idx) => (
                                  <tr key={item.id ?? idx}>
                                    <td>{item.item_description}</td>
                                    <td>{item.quantity ?? ""}</td>
                                    <td>{item.uom ?? ""}</td>
                                    <td>{item.is_inventoriable ? "Yes" : "No"}</td>
                                    <td>
                                      {item.is_inventoriable ? (
                                        <span className="text-muted">—</span>
                                      ) : (
                                        <>
                                          <span className={`badge ${getUrgentDeliveryBadge(item.delivery_status, item.quantity_delivered).className}`}>
                                            {getUrgentDeliveryBadge(item.delivery_status, item.quantity_delivered).label}
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
                                ))}
                              </tbody>
                            </table>

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

                            {row.supervisor_status === "pending" && (
                              canApproveUrgentAsSupervisor(row) ? (
                                <div className="d-flex gap-2">
                                  <button
                                    className="btn btn-sm btn-success"
                                    onClick={() => reviewUrgentRequestAsSupervisor(row.id, "approved")}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={() => setUrgentDeclineTarget(row.id)}
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <span className="badge bg-secondary">Awaiting manager approval</span>
                              )
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

      {activeReimbursementTab && (
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
            <ListStatusMessage loading={loadingReimbursementRequests} empty={reimbursementRequests.length === 0} loadingText="Loading reimbursement requests..." emptyText="No reimbursement requests." />
            {reimbursementRequests.map((row) => {
              const expanded = expandedReimbursementIds.has(row.id);
              return (
                <div key={row.id} className={styles.requestCard}>
                  <div
                    className={`${styles.urgentListRow} ${styles.urgentListRowAmount} ${expanded ? styles.urgentListRowExpanded : ""}`}
                    {...toggleRowProps(expanded, () => toggleReimbursementRow(row.id))}
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
                      <span className={`badge ${getBsStatusBadgeClass(row.supervisor_status)}`}>
                        {formatStatusLabel(row.supervisor_status)}
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
                              request={row}
                              onReplaced={() => void reloadReimbursementRequests()}
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

                            {row.supervisor_status === "pending" && (
                              canApproveReimbursementAsSupervisor(row) ? (
                                <div className="d-flex gap-2">
                                  <button
                                    className="btn btn-sm btn-success"
                                    onClick={() => reviewReimbursementAsSupervisor(row.id, "approved")}
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
                              ) : (
                                <span className="badge bg-secondary">Awaiting manager approval</span>
                              )
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

      <DeleteReasonModal
        isOpen={urgentDeclineTarget !== null}
        title="Decline Urgent Request"
        onClose={() => setUrgentDeclineTarget(null)}
        onConfirm={(reason) => {
          if (urgentDeclineTarget !== null) void reviewUrgentRequestAsSupervisor(urgentDeclineTarget, "rejected", reason);
          setUrgentDeclineTarget(null);
        }}
      />

      <DeleteReasonModal
        isOpen={reimbursementDeclineTarget !== null}
        title="Decline Reimbursement Request"
        onClose={() => setReimbursementDeclineTarget(null)}
        onConfirm={(reason) => {
          if (reimbursementDeclineTarget !== null) void reviewReimbursementAsSupervisor(reimbursementDeclineTarget, "rejected", reason);
          setReimbursementDeclineTarget(null);
        }}
      />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editMode ? "Edit Request" : "Approve / Decline Request"}
      >
        <div className="row mb-4" style={{ background: "#f8fafc", borderRadius: "8px", padding: "0.75rem", margin: 0 }}>
          <div className="col-6">
            <small className="text-muted text-uppercase fw-bold" style={{ fontSize: "11px", display: "block" }}>Serial</small>
            <strong>{selectedRequest?.serial}</strong>
          </div>
          <div className="col-6">
            <small className="text-muted text-uppercase fw-bold" style={{ fontSize: "11px", display: "block" }}>Department</small>
            <strong>{selectedRequest?.department}</strong>
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="editPurpose">Purpose</label>
          <input
            id="editPurpose"
            type="text"
            className="form-control"
            value={editFormData.purpose}
            onChange={(e) => setEditFormData({ ...editFormData, purpose: e.target.value })}
            disabled={!editMode}
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="editRemarks">Remarks</label>
          <textarea
            id="editRemarks"
            className="form-control"
            rows={3}
            value={editFormData.remarks}
            onChange={(e) => setEditFormData({ ...editFormData, remarks: e.target.value.toUpperCase() })}
            disabled={!editMode}
          />
        </div>

        {!editMode && (
          <div className="mb-3">
            <div className="form-label" id="decisionLabel">Decision</div>
            <div className="d-flex gap-4 p-3" role="radiogroup" aria-labelledby="decisionLabel" style={{ border: "1px solid #e5e7eb", borderRadius: "8px" }}>
              <div className="form-check">
                <input className="form-check-input" type="radio" name="statusRadio" id="approveRadio" value="approved" checked={newStatus === "approved"} onChange={(e) => setNewStatus(e.target.value)} />
                <label className="form-check-label fw-bold" style={{ color: "#15803d" }} htmlFor="approveRadio">Approve</label>
              </div>
              <div className="form-check">
                <input className="form-check-input" type="radio" name="statusRadio" id="rejectRadio" value="rejected" checked={newStatus === "rejected"} onChange={(e) => setNewStatus(e.target.value)} />
                <label className="form-check-label fw-bold" style={{ color: "#b91c1c" }} htmlFor="rejectRadio">Decline</label>
              </div>
            </div>
          </div>
        )}

        {!editMode && newStatus === "rejected" && (
          <div className="mb-3">
            <label className="form-label" style={{ color: "#b91c1c" }} htmlFor="declineReason">Decline Reason (Required)</label>
            <textarea
              id="declineReason"
              className="form-control"
              rows={2}
              value={rejectionComment}
              onChange={(e) => setRejectionComment(e.target.value.toUpperCase())}
              placeholder="Enter reason for declining..."
              required
            />
          </div>
        )}

        <div className="modal-actions">
          {editMode ? (
            <>
              <button type="button" onClick={() => setEditMode(false)} className="btn btn-secondary">Discard</button>
              <button type="button" onClick={handleEdit} className="btn btn-success">Save Changes</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditMode(true)} className="btn btn-warning">Edit Request</button>
              <button
                type="button"
                onClick={handleStatusUpdate}
                className={`btn ${newStatus === "rejected" ? "btn-danger" : "btn-primary"}`}
                disabled={newStatus === "rejected" && !rejectionComment.trim()}
              >
                {newStatus === "rejected" ? "Decline" : "Approve"}
              </button>
            </>
          )}
        </div>
      </Modal>
    </Layout>
  );
};

export default SupervisorDashboard;
