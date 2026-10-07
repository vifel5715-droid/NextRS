import React from "react";
import Layout from "@shared/components/Layout";
import Modal from "@shared/components/Modal";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import ApprovalStatusPanel from "@features/requests/components/ApprovalStatusPanel";
import AdjustmentHistoryModal from "@features/adjustments/components/AdjustmentHistoryModal";
// Lazy-loaded — Item List is opened far less often than the dashboard itself
// is viewed, and its ~500-line implementation (catalog CRUD form + table)
// doesn't need to be in the initial bundle for every custodian who never
// opens it this session. Its own data fetch is already gated behind `isOpen`
// internally, so this only changes when the JS itself is fetched, not when
// any API call happens.
const ItemCatalogModal = React.lazy(() => import("@features/item-catalog/components/ItemCatalogModal"));
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import { getBsStatusBadgeClass, getStatusBadgeClass, formatStatusLabel, getHeldServiceCount, hasEditedHeldService } from "@shared/utils/status";
import { useCustodianRequests } from "@features/requests/hooks/useCustodianRequests";
import { useUrgentRequests } from "@features/requests/hooks/useUrgentRequests";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import { useAuth } from "@app/providers/AuthProvider";
import { makeRequestKey } from "@shared/utils/requestKey";
import { itemRequestAPI } from "../../../services/api";
import { UOM_OPTIONS } from "../../../constants/uom";
import type { ItemAudit, ItemRow, ServiceRow, RequestRow, FieldValue } from "@shared/types";
import IssuanceHistory from "@features/requests/components/IssuanceHistory";
import { ItemExistenceBadge } from "@shared/components/ItemExistenceStatus";
import { useItemCatalogNames } from "@features/item-catalog/hooks/useItemCatalogNames";
import { getItemExistenceStatus } from "@shared/utils/itemExistenceStatus";
import { copyToClipboard, formatItemsForClipboard, formatItemsForProjectGrid } from "@shared/utils/clipboard";
import { formatMilitaryTime, formatMilitaryDateTime } from "@shared/utils/format";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import ListToolbar from "@shared/components/ListToolbar";
import { exportToExcel } from "@shared/utils/exportExcel";
import { getCompositeStatus } from "@shared/utils/status";
import styles from "./Dashboard.module.css";

/** Per-value tint for the delivery-status <select> in the Items table, so the
 * current status reads as a status at a glance instead of blending into every
 * other plain input on the row. */
const DELIVERY_STATUS_STYLES: Record<string, React.CSSProperties> = {
  OUT: { backgroundColor: "#eff6ff", color: "#1d4ed8", borderColor: "#93c5fd", fontWeight: 600 },
  "PURCHASE REQUEST": { backgroundColor: "#fffbeb", color: "#b45309", borderColor: "#fcd34d", fontWeight: 600 },
  URGENT: { backgroundColor: "#f5f3ff", color: "#6d28d9", borderColor: "#c4b5fd", fontWeight: 600 },
  HOLD: { backgroundColor: "#fef2f2", color: "#b91c1c", borderColor: "#fca5a5", fontWeight: 600 },
};

/** Same idea as DELIVERY_STATUS_STYLES, for the PR Status field in the Details panel. */
const PR_STATUS_STYLES: Record<string, React.CSSProperties> = {
  PENDING: { backgroundColor: "#fffbeb", color: "#b45309", borderColor: "#fcd34d", fontWeight: 600 },
  DELIVERED: { backgroundColor: "#f0fdf4", color: "#15803d", borderColor: "#86efac", fontWeight: 600 },
  "DELIVERED PARTIAL": { backgroundColor: "#eff6ff", color: "#1d4ed8", borderColor: "#93c5fd", fontWeight: 600 },
};

const CustodianDashboard: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isAdmin = role === "admin";
  // Director is routed to this same page as custodian/admin (App.tsx) so it
  // can see every pending request, but must never act on one — everything
  // below that isn't already admin/custodian-gated folds this in, mirroring
  // HeldItemsPage's canEdit pattern (isRowDirty can never become true when
  // the fields that would set it are themselves never rendered editable).
  // Operations Manager can see this page too (cross-cutting approval
  // visibility) but Custodian approval stays Custodian's alone — same
  // read-only treatment as Director.
  const isReadOnlyRole = role === "director" || role === "operations_manager";
  const { startDate, endDate } = useDateRangeContext();
  const itemCatalogNames = useItemCatalogNames();
  const machineCodeOptions = useMachineCodeOptions();
  const {
    activeTab,
    setActiveTab,
    itemRequests,
    serviceRequests,
    filteredItemRequests,
    filteredServiceRequests,
    selectedDepartment,
    setSelectedDepartment,
    selectedRequest,
    showModal,
    setShowModal,
    newStatus,
    setNewStatus,
    rejectionComment,
    setRejectionComment,
    expandedRows,
    requestDetails,
    editableServices,
    hasItemChanges,
    hasServiceChanges,
    dirtyItemIds,
    itemNameDirtyIds,
    savingAllRequestIds,
    searchQuery,
    setSearchQuery,
    handleRowClick,
    handleStatusClick,
    handleStatusUpdate,
    handleSaveRequestInfo,
    handleSaveItem,
    handleSaveAllItems,
    handleSaveServiceUpdates,
    handleSupervisorAction,
    handleResetApproval,
    handleDeleteAudit,
    updateItemField,
    updateService,
    updateServiceIndexes,
    updateRequestDetail,
    getUniqueDepartments,
    filterByDepartment,
    handlePrint,
    handlePrintout,
    handleClearReceivingReport,
  } = useCustodianRequests();

  const { urgentRequests, loadingUrgentRequests, reviewUrgentRequest, expandedUrgentIds, toggleUrgentRow, setItemInventoriable, savingItemInventoriableId } = useUrgentRequests();

  const [activeUrgentTab, setActiveUrgentTab] = React.useState(false);
  const [urgentDeclineTarget, setUrgentDeclineTarget] = React.useState<number | null>(null);

  // Which item/service is queued for deletion, pending a typed reason —
  // see DeleteReasonModal below.
  const [deleteTarget, setDeleteTarget] = React.useState<{ requestId: number; entityId: number; type: "audit" | "rr" } | null>(null);

  // Which item request's Adjustment History modal is open, if any.
  const [historyRequestId, setHistoryRequestId] = React.useState<number | null>(null);

  const [showItemCatalogModal, setShowItemCatalogModal] = React.useState(false);

  // Bulk selection, kept per request so two expanded requests never share a
  // selection. Checking rows makes them edit together — see updateSelectedItemField.
  const [selectedItems, setSelectedItems] = React.useState<Map<number, Set<number>>>(new Map());

  const getSelection = (requestId: number): Set<number> =>
    selectedItems.get(requestId) ?? new Set<number>();

  const toggleItemSelected = (requestId: number, itemId: number) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(requestId) ?? []);
      if (set.has(itemId)) set.delete(itemId);
      else set.add(itemId);
      if (set.size === 0) next.delete(requestId);
      else next.set(requestId, set);
      return next;
    });
  };

  const toggleSelectAll = (requestId: number, itemIds: number[]) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      const current = next.get(requestId);
      // Already everything? Then this is a deselect-all.
      if (current && current.size === itemIds.length) next.delete(requestId);
      else next.set(requestId, new Set(itemIds));
      return next;
    });
  };

  // Same idea for service rows. Keyed by row index rather than id, because the
  // services table renders straight from the editable copy by position.
  const [selectedServices, setSelectedServices] = React.useState<Map<number, Set<number>>>(new Map());

  const getServiceSelection = (requestId: number): Set<number> =>
    selectedServices.get(requestId) ?? new Set<number>();

  const toggleServiceSelected = (requestId: number, index: number) => {
    setSelectedServices((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(requestId) ?? []);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      if (set.size === 0) next.delete(requestId);
      else next.set(requestId, set);
      return next;
    });
  };

  const toggleSelectAllServices = (requestId: number, count: number) => {
    setSelectedServices((prev) => {
      const next = new Map(prev);
      const current = next.get(requestId);
      if (current && current.size === count) next.delete(requestId);
      else next.set(requestId, new Set(Array.from({ length: count }, (_, i) => i)));
      return next;
    });
  };

  /**
   * Service counterpart of updateSelectedItemField. Applies to the whole
   * selection in one call — looping per row would read a stale array each time
   * and only the last row would stick.
   */
  const updateSelectedService = (requestId: number, index: number, field: string, value: FieldValue) => {
    const selection = getServiceSelection(requestId);
    const targets = selection.has(index) ? Array.from(selection) : [index];
    updateServiceIndexes(requestId, targets, field, value);
  };

  /**
   * Edits one item — or every selected item, when the edited row is itself part
   * of the selection. That way a value typed once fills the whole selection as
   * you type. An unchecked row always edits only itself.
   */
  const updateSelectedItemField = (
    requestId: number,
    index: number,
    item: ItemRow,
    items: ItemRow[],
    field: string,
    value: FieldValue
  ) => {
    const selection = getSelection(requestId);
    if (item.id === undefined || !selection.has(item.id)) {
      updateItemField(requestId, index, field, value);
      return;
    }
    items.forEach((other, i) => {
      if (other.id !== undefined && selection.has(other.id)) {
        updateItemField(requestId, i, field, value);
      }
    });
  };

  // Brief "Copied" acknowledgement, keyed so two rows never both light up.
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const copyItems = async (key: string, items: ItemRow[]) => {
    if (items.length === 0) return;
    const ok = await copyToClipboard(formatItemsForClipboard(items));
    if (!ok) {
      alert("Copy failed — your browser blocked clipboard access.");
      return;
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  // Same idea as copyItems, but formatted for the "Item No. / Item
  // Description / Serial No. / Required Date / Required Qty. / UoM Code /
  // Project" external grid instead — Project receives Machine Code on that
  // grid, and Serial No. receives our own request serial.
  const copyItemsForProjectGrid = async (key: string, items: ItemRow[], serial: string) => {
    if (items.length === 0) return;
    const ok = await copyToClipboard(formatItemsForProjectGrid(items, serial));
    if (!ok) {
      alert("Copy failed — your browser blocked clipboard access.");
      return;
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const handleDownloadAttachment = async (id: number, _filename: string) => {
    try {
      const response = await itemRequestAPI.downloadAttachment(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      alert("Failed to open attachment");
    }
  };

  const renderSummaryRow = (row: RequestRow) => (
    <div
      className={`${styles.requestCardRow} ${expandedRows.has(makeRequestKey(activeTab, row.id)) ? styles.requestCardRowExpanded : ""}`}
      onClick={() => handleRowClick(row)}
    >
      <div className="text-center">
        <i className={`bi bi-chevron-${expandedRows.has(makeRequestKey(activeTab, row.id)) ? "down" : "right"}`}></i>
      </div>
      <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
      <div className="text-muted" data-label="Date">{row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : ""}</div>
      <div className="hide-sm" data-label="By">{row.created_by}</div>
      <div className="hide-sm" data-label="Dept">{row.department}</div>
      <div data-label="Purpose">{row.purpose}</div>
      <div>
        {row.all_items_served ? (
          <span className={`${styles.statusText} ${styles.approved}`}>ALL ITEM ARE FULLY SERVED</span>
        ) : row.has_held_item && row.status !== "rejected" ? (
          // Display-only — does not touch the underlying `status`/custodian_status
          // fields, so an already-approved request keeps its real approval intact
          // (Approval Status / Custodian Action panels below) while a Hold is in
          // effect. A rejected request stays "rejected" even with a stale HOLD
          // item. See ItemRow.hold_edited / has_edited_held_item.
          <span className={`${styles.statusText} ${styles.held}`}>
            {row.has_edited_held_item ? "RELEASE ON HOLD" : "ON HOLD"}{row.held_item_count ? ` (${row.held_item_count})` : ""}
          </span>
        ) : getHeldServiceCount(row as { services?: ServiceRow[] }) > 0 && row.status !== "rejected" ? (
          // Service equivalent — see HeldItemsPage.tsx's ARCH comment for the
          // hand-off workflow hold_edited is tracking.
          <span className={`${styles.statusText} ${styles.held}`}>
            {hasEditedHeldService(row as { services?: ServiceRow[] }) ? "RELEASE ON HOLD" : "ON HOLD"} ({getHeldServiceCount(row as { services?: ServiceRow[] })})
          </span>
        ) : (
          <span className={`${styles.statusText} ${styles[getStatusBadgeClass(row.status)]}`}>{row.status}</span>
        )}
      </div>
    </div>
  );

  const renderItemDetail = (row: RequestRow) => {
    const details = requestDetails.get(makeRequestKey("item", row.id));
    if (!details) return null;
    const isApproved = (details.custodian_status === "approved" || isAdmin) && !isReadOnlyRole;
    const items: ItemRow[] = details.items ?? [];
    // Selection is keyed by item id; rows without one cannot be selected.
    const itemIds = items.map((i) => i.id).filter((id): id is number => id !== undefined);
    return (
      <div className={styles.requestCardBody}>
        <div className="d-flex flex-wrap align-items-center gap-2 ps-3 pt-2">
          <button onClick={() => handlePrint(row.id, "item")} className="btn btn-sm btn-primary" title="Print Item Request Slip">
            <i className="bi bi-printer me-1"></i>Print Purchase Request Slip
          </button>
          <button onClick={() => handlePrintout(row.id, "item")} className="btn btn-sm btn-primary" title="Print Item Request Slip">
            <i className="bi bi-printer me-1"></i>Print Out Slip
          </button>
          <button onClick={() => setHistoryRequestId(row.id)} className="btn btn-sm btn-primary" title="Adjustment History">
            <i className="bi bi-clock-history me-1"></i>Adjustment History
          </button>
        </div>
        <div className="p-3">
          {/* Request Information */}
          <div className="border rounded p-3 mb-3 bg-light">
            <div className="fw-semibold text-secondary small text-uppercase mb-3">Request Information</div>
            <div className="row g-3 info-grid">
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Serial</div>
                <div className="fw-semibold">{details.serial}</div>
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Created Time</div>
                <div className="fw-semibold">{formatMilitaryTime(details.created_at)}</div>
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Department</div>
                <div className="fw-semibold">{details.department}</div>
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Requested By</div>
                <div className="fw-semibold">{sanitizeUserInput(details.requested_by || "—")}</div>
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
                {/* Display-only — a Held item never touches the underlying `status`/
                    custodian_status, so this overlays "ON HOLD"/"RELEASE ON HOLD"
                    without disturbing the real approval shown in Approval Status
                    below. A rejected request stays "rejected" even with a stale
                    HOLD item. */}
                {items.some((i) => i.delivery_status === "HOLD") && details.status !== "rejected" ? (
                  <span className="badge bg-danger">
                    {items.some((i) => i.delivery_status === "HOLD" && i.hold_edited) ? "RELEASE ON HOLD" : "ON HOLD"}
                    {` (${items.filter((i) => i.delivery_status === "HOLD").length})`}
                  </span>
                ) : (
                  <span className={`badge ${getBsStatusBadgeClass(details.status)}`}>{details.status}</span>
                )}
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
                {isAdmin ? (
                  <input type="text" className="form-control form-control-sm text-uppercase" value={details.remarks || ""} onChange={(e) => updateRequestDetail(row.id, "remarks", e.target.value.toUpperCase(), "item")} />
                ) : (
                  <div>{sanitizeUserInput(details.remarks || "—")}</div>
                )}
              </div>
              <div className="col-12 col-sm-6 col-md info-field">
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
                {isAdmin ? (
                  <textarea className="form-control form-control-sm text-uppercase" rows={2} value={details.purpose || ""} onChange={(e) => updateRequestDetail(row.id, "purpose", e.target.value.toUpperCase(), "item")} />
                ) : (
                  <div>{sanitizeUserInput(details.purpose || "—")}</div>
                )}
              </div>
              {details.attachment_name && (
                <div className="col-12 col-sm-6 col-md info-field">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>Attachment</div>
                  <button
                    type="button"
                    className="btn btn-link p-0"
                    onClick={() => handleDownloadAttachment(row.id, details.attachment_name || "attachment.pdf")}
                  >
                    <i className="bi bi-file-earmark-pdf me-1"></i>
                    {sanitizeUserInput(details.attachment_name || "Download")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Approval Status — shown for every role, admin included, since
              the admin-only Action boxes below only offer controls (Reset),
              not who actually approved it or what their role was. */}
          <ApprovalStatusPanel
            supervisorStatus={details.supervisor_status}
            supervisorApprovedByName={details.supervisor_name || details.supervisor_approved_by_name}
            supervisorApprovedByRole={details.supervisor_approved_by_role}
            supervisorApprovedAt={details.supervisor_approved_at}
            custodianStatus={details.custodian_status}
            custodianApprovedByName={details.custodian_name || details.custodian_approved_by_name}
            custodianApprovedByRole={details.custodian_approved_by_role}
            custodianApprovedAt={details.custodian_approved_at}
            rejectionComment={details.rejection_comment}
          />

          {/* Supervisor Action */}
          {isAdmin && (
            <div className="border rounded p-3 mb-3">
              <div className="fw-semibold text-secondary small text-uppercase mb-2">Supervisor Action</div>
              {details.supervisor_status && details.supervisor_status !== "pending" ? (
                <div className="d-flex align-items-center gap-2">
                  <span className={`badge fs-6 ${getBsStatusBadgeClass(details.supervisor_status)}`}>{formatStatusLabel(details.supervisor_status)}</span>
                  <button onClick={() => handleResetApproval(row.id, "item", "supervisor")} className="btn btn-sm btn-outline-danger">
                    <i className="bi bi-arrow-counterclockwise me-1"></i>Reset to Pending
                  </button>
                </div>
              ) : (
                <div className="d-flex gap-2">
                  <button onClick={() => handleSupervisorAction(row, "approve")} className="btn btn-success btn-sm w-100">Approve</button>
                  <button onClick={() => handleSupervisorAction(row, "reject")} className="btn btn-outline-danger btn-sm w-100">Decline</button>
                </div>
              )}
            </div>
          )}

          {/* Custodian Action */}
          <div className="border rounded p-3 mb-3">
            <div className="fw-semibold text-secondary small text-uppercase mb-2">Custodian Action</div>
            {details.custodian_status && details.custodian_status !== "pending" ? (
              <div className="d-flex align-items-center gap-2">
                <span className={`badge fs-6 ${getBsStatusBadgeClass(details.custodian_status)}`}>{formatStatusLabel(details.custodian_status)}</span>
                {isAdmin && (
                  <button onClick={() => handleResetApproval(row.id, "item", "custodian")} className="btn btn-sm btn-outline-danger">
                    <i className="bi bi-arrow-counterclockwise me-1"></i>Reset to Pending
                  </button>
                )}
              </div>
            ) : isReadOnlyRole ? (
              <span className="badge fs-6 bg-warning text-dark">Pending</span>
            ) : (
              <button onClick={() => handleStatusClick(row)} className="btn btn-primary btn-sm w-100">
                <i className="bi bi-check2-circle me-1"></i>Approve / Decline
              </button>
            )}
          </div>
          <hr className="mt-4 mb-4" />
          <div className="d-flex align-items-center flex-wrap gap-2 mb-4">
            <h5 className="mb-0">Items</h5>
            {(() => {
              // Copies the checked rows, or the whole table when nothing is checked.
              const selection = getSelection(row.id);
              const rowsToCopy = selection.size > 0
                ? items.filter((i) => i.id !== undefined && selection.has(i.id))
                : items;
              const key = `items-${row.id}`;
              // Save All only ever touches rows that are BOTH checked and
              // dirty — checking a row alone (with no edits) has nothing to
              // save, and an edited-but-unchecked row is left alone so the
              // checkboxes stay the one deliberate way to scope a bulk action.
              const selectedDirtyIds = Array.from(selection).filter((id) => dirtyItemIds.has(id));
              const isSavingAll = savingAllRequestIds.has(row.id);
              return (
                <>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    title="Copy Item Name, Quantity, UoM and Machine Code — paste straight into a spreadsheet or another system's grid"
                    disabled={rowsToCopy.length === 0}
                    onClick={() => copyItems(key, rowsToCopy)}
                  >
                    <i className={`bi ${copiedKey === key ? "bi-check2" : "bi-clipboard"} me-1`}></i>
                    {copiedKey === key
                      ? "Copied"
                      : selection.size > 0
                        ? `Copy ${selection.size} selected`

                        : "Copy To Issue"}
                  </button>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    title="Copy Item Description, Serial No., Required Qty., UoM Code and Project (Machine Code) — paste straight into the Item No./Item Description/Serial No./Required Date/Required Qty./UoM Code/Project grid"
                    disabled={rowsToCopy.length === 0}
                    onClick={() => copyItemsForProjectGrid(`${key}-project`, rowsToCopy, row.serial)}
                  >
                    <i className={`bi ${copiedKey === `${key}-project` ? "bi-check2" : "bi-clipboard"} me-1`}></i>
                    {copiedKey === `${key}-project` ? "Copied" : "Copy for Purchase Request"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    title="Save every checked row that has unsaved changes"
                    disabled={selectedDirtyIds.length === 0 || isSavingAll}
                    onClick={() => handleSaveAllItems(row.id, selectedDirtyIds)}
                  >
                    {isSavingAll ? (
                      <>
                        <span className="button-spinner" aria-hidden="true" style={{ marginRight: "0.4rem" }} />
                        Saving…
                      </>
                    ) : (
                      <>
                        <i className="bi bi-save me-1"></i>
                        {selectedDirtyIds.length > 0 ? `Save All (${selectedDirtyIds.length})` : "Save All"}
                      </>
                    )}
                  </button>
                </>
              );
            })()}
          </div>
          <div className={styles.itemCardsPanel}>
            <div className={styles.itemCardsHeader}>
              <div>
                <input
                  type="checkbox"
                  className="form-check-input"
                  title="Select all items"
                  disabled={!isApproved}
                  checked={itemIds.length > 0 && getSelection(row.id).size === itemIds.length}
                  onChange={() => toggleSelectAll(row.id, itemIds)}
                />
              </div>
              <div>#</div>
              <div>Item Name</div>
              <div>Quantity</div>
              <div>UoM</div>
              <div>Remarks</div>
              <div>Machine Code</div>
              <div>Balance</div>
              <div>Existence Status</div>
              <div>Status</div>
              <div>Actions</div>
            </div>
            {items.map((item, index) => {
                  // Stock releases and partial deliveries are listed separately —
                  // an OUT release only appears once the custodian actually issues it.
                  const audits: ItemAudit[] = item.audits || [];
                  // The two counters are independent, so each input has its own cap.
                  const outstandingToDeliver = Math.max(0, (item.quantity || 0) - (item.quantity_delivered || 0));
                  const outstandingToRelease = Math.max(0, (item.quantity || 0) - (item.quantity_out || 0));
                  // Items always carry an id once persisted; -1 keeps the
                  // unsaved case out of the selection rather than matching row 0.
                  const itemId = item.id ?? -1;
                  const isSelected = getSelection(row.id).has(itemId);
                  const existenceStatus = getItemExistenceStatus(item.item_name, itemCatalogNames);
                  // Admin can always fix a name; a custodian only gets an edit
                  // field once the name doesn't match the catalog — otherwise
                  // it's read-only for them, same as before. A blank name gets
                  // the same treatment as "not_found" (which getItemExistenceStatus
                  // can't itself report — an empty query is null, not not_found) so
                  // a cleared name isn't a dead end only admin can recover from.
                  // A row whose NAME is already mid-edit stays editable regardless
                  // of what the live-typed value resolves to — locking it back to
                  // plain text the instant a keystroke happens to match the catalog
                  // would yank the input out from under whoever is still typing.
                  // Deliberately narrower than "is any field on this row dirty":
                  // editing an unrelated field (Quantity, Machine Code, PR Status, etc.)
                  // must never silently unlock a catalog-matched name that nobody
                  // touched. The lock only re-applies once the row goes back to
                  // "saved" (not dirty) and that saved name is an exact catalog match.
                  const isItemNameDirty = item.id !== undefined && itemNameDirtyIds.has(item.id);
                  // Once an item is placed on HOLD, custodian loses edit access to
                  // that row entirely — every field and action button locks. Admin
                  // is exempt, same as every other "admin can always" rule on this
                  // page. (Secretary/Supervisor/Manager, who gain edit access on a
                  // HOLD item instead, don't have a route into this page — see the
                  // Held Items page for their side of this workflow.)
                  const isHeldLocked = item.delivery_status === "HOLD" && !isAdmin;
                  const canEditItemName = !isReadOnlyRole && !isHeldLocked && (isAdmin || isItemNameDirty || existenceStatus === "not_found" || !item.item_name?.trim());
                  return (
                  <div key={index} className={`${styles.itemCard} ${isSelected ? styles.itemCardSelected : ""}`}>
                    <div className={styles.itemCardRow}>
                    <div data-label="Select">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        disabled={!isApproved || isHeldLocked}
                        checked={isSelected}
                        onChange={() => toggleItemSelected(row.id, itemId)}
                      />
                    </div>
                    <div data-label="#">{index + 1}</div>
                    <div data-label="Item Name">
                      {canEditItemName ? (
                        <SearchableCombobox
                          className="form-control form-control-sm text-uppercase"
                          value={item.item_name || ""}
                          onChange={(value) => updateItemField(row.id, index, "item_name", value.toUpperCase())}
                          options={itemCatalogNames}
                          placeholder="Search or type item name…"
                          onEnter={item.id !== undefined ? () => handleSaveItem(row.id, item.id!) : undefined}
                        />
                      ) : (
                        <span style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{item.item_name}</span>
                      )}
                    </div>
                    <div data-label="Quantity">
                      {isAdmin && !isHeldLocked ? (
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          style={{ width: "90px" }}
                          value={item.quantity ?? ""}
                          onChange={(e) => updateItemField(row.id, index, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                          onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(row.id, item.id); } }}
                        />
                      ) : item.quantity}
                    </div>
                    <div data-label="UoM">
                      {isAdmin && !isHeldLocked ? (
                        <select
                          className="form-select form-select-sm text-uppercase"
                          style={{ width: "110px" }}
                          aria-label={`UoM for ${item.item_name || `item ${index + 1}`}`}
                          value={(UOM_OPTIONS as readonly string[]).includes(item.uom) ? item.uom : ""}
                          onChange={(e) => updateItemField(row.id, index, "uom", e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(row.id, item.id); } }}
                        >
                          <option value="" disabled>Select UoM</option>
                          {UOM_OPTIONS.map((uom) => (
                            <option key={uom} value={uom}>{uom}</option>
                          ))}
                        </select>
                      ) : item.uom}
                    </div>
                    <div data-label="Remarks">{sanitizeUserInput(item.remarks || "N/A")}</div>
                    <div data-label="Machine Code">
                      {isAdmin && !isHeldLocked ? (
                        <SearchableCombobox
                          className="form-control form-control-sm text-uppercase"
                          value={item.machine_code || ""}
                          onChange={(value) => updateItemField(row.id, index, "machine_code", value)}
                          options={machineCodeOptions.options}
                          descriptions={machineCodeOptions.descriptions}
                          placeholder="Search or type…"
                          noResultsText="No record found"
                          onEnter={item.id !== undefined ? () => handleSaveItem(row.id, item.id!) : undefined}
                        />
                      ) : sanitizeUserInput(item.machine_code || "N/A")}
                    </div>
                    <div data-label="Balance">{item.qty_balance ?? (item.quantity - (item.quantity_delivered || 0))}</div>
                    <div data-label="Existence Status">
                      <ItemExistenceBadge status={existenceStatus} />
                    </div>
                    <div data-label="Status">
                      {/* Custodian keeps full control of Status even once an item is HOLD —
                          only Status; item name/qty/delete stay locked (see isHeldLocked
                          above). Explicitly reversed after the HOLD hand-off restriction
                          turned out to also block custodian from ever un-holding an item
                          themselves, which wasn't intended. */}
                      {/* A `disabled` native <select> swallows every mouse event over
                          its own box in Chrome/Firefox — a `title` on it, or on a
                          wrapper around it, never fires while the pointer sits
                          directly over the control. The fix is a transparent
                          overlay positioned on top of (not just around) the
                          select, so it's the one actually receiving the hover. */}
                      <div style={{ position: "relative" }}>
                        <select
                          className="form-select form-select-sm w-100"
                          value={item.delivery_status || ""}
                          disabled={!isApproved || existenceStatus === "not_found"}
                          style={{
                            ...(item.delivery_status ? DELIVERY_STATUS_STYLES[item.delivery_status] : undefined),
                            ...(existenceStatus === "not_found" ? { cursor: "not-allowed" } : undefined),
                          }}
                          onChange={(e) => updateSelectedItemField(row.id, index, item, items, "delivery_status", e.target.value)}
                        >
                          <option value="">Select Status</option>
                          <option value="OUT">OUT</option>
                          <option value="PURCHASE REQUEST">PURCHASE REQUEST</option>
                          <option value="URGENT">URGENT</option>
                          {/* Same underlying "HOLD" value either way — only the
                              label changes, based on whether Secretary/Supervisor/
                              Manager have already fixed the item's details (see
                              hold_edited, set server-side in updateRequestItem). */}
                          <option value="HOLD">{item.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                        </select>
                        {existenceStatus === "not_found" && (
                          <div
                            title="Item name not found in system. Please update the ITEM NAME to match an existing registered item in the system before changing the status."
                            style={{ position: "absolute", inset: 0, cursor: "not-allowed" }}
                          />
                        )}
                      </div>
                    </div>
                    <div data-label="Actions">
                      <div className="d-flex gap-1">
                        {item.id !== undefined && dirtyItemIds.has(item.id) && (
                          <button
                            className="btn btn-sm btn-primary"
                            title="Save this row"
                            onClick={() => handleSaveItem(row.id, item.id!)}
                          >
                            <i className="bi bi-save"></i>
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          title="Copy Item Name, Quantity, UoM and Machine Code"
                          onClick={() => copyItems(`item-${item.id}`, [item])}
                        >
                          <i className={`bi ${copiedKey === `item-${item.id}` ? "bi-check2" : "bi-clipboard"}`}></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          title="Copy for the Item No./Item Description/Serial No./Required Date/Required Qty./UoM Code/Project grid"
                          onClick={() => copyItemsForProjectGrid(`item-project-${item.id}`, [item], row.serial)}
                        >
                          <i className={`bi ${copiedKey === `item-project-${item.id}` ? "bi-check2" : "bi-clipboard-plus"}`}></i>
                        </button>
                      </div>
                    </div>
                    </div>
                    {item.delivery_status && (
                      <div className={styles.itemCardDetails}>
                        <div className="table-responsive">
                        <table className="table table-sm mb-0" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #dee2e6", borderRadius: "6px", overflow: "hidden", backgroundColor: "#fafbfc" }}>
                          <tbody>
                            {item.delivery_status === "OUT" && outstandingToRelease > 0 && (
                              <>
                                <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                  <td style={{ width: "110px", padding: "12px 16px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Issuance No.</td>
                                  <td style={{ padding: "12px 16px", border: "none" }}>
                                    <input type="text" className="form-control form-control-sm" placeholder="Issuance Number" value={item.issuance_number || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(row.id, index, item, items, "issuance_number", e.target.value)} />
                                  </td>
                                </tr>
                                    <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                      <td style={{ width: "110px", padding: "12px 16px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Qty Out</td>
                                      <td style={{ padding: "12px 16px", border: "none" }}>
                                        <input type="number" min="0" max={outstandingToRelease} className="form-control form-control-sm" placeholder={`Qty Out (max ${outstandingToRelease})`} value={item.quantity_out_now ?? outstandingToRelease} disabled={!isApproved} onChange={(e) => updateSelectedItemField(row.id, index, item, items, "quantity_out_now", e.target.value === "" ? undefined : parseInt(e.target.value) || 0)} />
                                      </td>
                                    </tr>
                              </>
                            )}
                            {(item.delivery_status === "PURCHASE REQUEST" || item.delivery_status === "URGENT") && (
                              <>
                                <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                  <td style={{ width: "110px", padding: "12px 16px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>{item.delivery_status === "URGENT" ? "Date Needed" : "PR Number"}</td>
                                  <td style={{ padding: "12px 16px", border: "none" }}>
                                    {item.delivery_status === "URGENT" ? (
                                      <input type="date" className="form-control form-control-sm" value={item.date_needed || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(row.id, index, item, items, "date_needed", e.target.value)} />
                                    ) : (
                                      <input type="text" className="form-control form-control-sm" placeholder="PR Number" value={item.pr_number || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(row.id, index, item, items, "pr_number", e.target.value)} />
                                    )}
                                  </td>
                                </tr>
                                <tr style={{ borderBottom: item.pr_status === "DELIVERED PARTIAL" ? "1px solid #dee2e6" : "none" }}>
                                  <td style={{ width: "110px", padding: "12px 16px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Order Status</td>
                                  <td style={{ padding: "12px 16px", border: "none" }}>
                                    <select
                                      className="form-select form-select-sm"
                                      value={item.pr_status || ""}
                                      disabled={!isApproved}
                                      style={item.pr_status ? PR_STATUS_STYLES[item.pr_status] : undefined}
                                      onChange={(e) => updateSelectedItemField(row.id, index, item, items, "pr_status", e.target.value)}
                                    >
                                      <option value="">Select Status</option>
                                      <option value="PENDING">Pending</option>
                                      <option value="DELIVERED">Delivered</option>
                                      <option value="DELIVERED PARTIAL">Partial Delivered</option>
                                    </select>
                                  </td>
                                </tr>
                              </>
                            )}
                            {(((item.delivery_status === "PURCHASE REQUEST" || item.delivery_status === "URGENT") && item.pr_status === "DELIVERED PARTIAL") || item.delivery_status === "PARTIAL DELIVERED") && (
                              <tr>
                                <td style={{ width: "110px", padding: "12px 16px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Qty Delivered</td>
                                <td style={{ padding: "12px 16px", border: "none" }}>
                                  <input type="number" min="0" max={outstandingToDeliver} className="form-control form-control-sm" placeholder={`Quantity (max ${outstandingToDeliver})`} value={item.quantity_delivered_now ?? ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(row.id, index, item, items, "quantity_delivered_now", e.target.value === "" ? undefined : parseInt(e.target.value) || 0)} />
                                </td>
                              </tr>
                            )}
                            {audits.length > 0 && (
                              <tr>
                                <td colSpan={2} style={{ padding: "0", border: "none" }}>
                                  <IssuanceHistory audits={audits} prNumber={(item.pr_type || item.delivery_status) === "URGENT" ? (item.date_needed ? new Date(item.date_needed).toLocaleDateString() : null) : item.pr_number} prNumberLabel={(item.pr_type || item.delivery_status) === "URGENT" ? "Date Needed" : "PR Number"} onDelete={isReadOnlyRole ? undefined : (auditId) => setDeleteTarget({ requestId: row.id, entityId: auditId, type: "audit" })} />
                                </td>
                              </tr>
                            )}
                            {item.delivery_status === "DELIVERED" && (
                              <tr><td colSpan={2} className="text-center">-</td></tr>
                            )}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
          </div>
          <div className="mt-4 mb-4 d-flex justify-content-end">
            {hasItemChanges.has(row.id) && (
              <button className="btn btn-primary btn-sm" onClick={() => handleSaveRequestInfo(row.id)}>
                <i className="bi bi-save me-1"></i>Save Request Info
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderServiceDetail = (row: RequestRow) => {
    const details = requestDetails.get(makeRequestKey("service", row.id));
    if (!details) return null;
    const isApproved = (details.custodian_status === "approved" || isAdmin) && !isReadOnlyRole;
    // Edited copy wins, so the checkbox indices line up with what is rendered.
    const serviceRows: ServiceRow[] = editableServices.get(row.id) || details.services || [];
    return (
      <div className={`${styles.requestCardBody} p-3`}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <button onClick={() => handlePrint(row.id, "service")} className="btn btn-sm btn-primary" title="Print Service Request Slip">
            <i className="bi bi-printer me-1"></i>Print SRS
          </button>
        </div>

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
              <div className="text-muted" style={{ fontSize: "0.75rem" }}>Requested By</div>
              <div className="fw-semibold">{sanitizeUserInput(details.requested_by || "—")}</div>
            </div>
            <div className="col-12 col-sm-6 col-md">
              <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
              {/* Display-only — a Holded service never touches the underlying
                  `status`/custodian_status, so this overlays "ON HOLD"/"RELEASE
                  ON HOLD" without disturbing the real approval shown below. A
                  rejected request stays "rejected" even with a stale Holded line. */}
              {serviceRows.some((s) => s.delivery_status === "holded") && details.status !== "rejected" ? (
                <span className="badge bg-danger">
                  {serviceRows.some((s) => s.delivery_status === "holded" && s.hold_edited) ? "RELEASE ON HOLD" : "ON HOLD"}
                  {` (${serviceRows.filter((s) => s.delivery_status === "holded").length})`}
                </span>
              ) : (
                <span className={`badge ${getBsStatusBadgeClass(details.status)}`}>{details.status}</span>
              )}
            </div>
            <div className="col-12 col-sm-6 col-md">
              <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
              {isAdmin ? (
                <input type="text" className="form-control form-control-sm text-uppercase" value={details.remarks || ""} onChange={(e) => updateRequestDetail(row.id, "remarks", e.target.value.toUpperCase(), "service")} />
              ) : (
                <div>{sanitizeUserInput(details.remarks || "—")}</div>
              )}
            </div>
            <div className="col-12 col-sm-6 col-md">
              <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
              {isAdmin ? (
                <textarea className="form-control form-control-sm text-uppercase" rows={2} value={details.purpose || ""} onChange={(e) => updateRequestDetail(row.id, "purpose", e.target.value.toUpperCase(), "service")} />
              ) : (
                <div>{sanitizeUserInput(details.purpose || "—")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Approval Status — shown for every role, admin included, since
            the admin-only Action boxes below only offer controls (Reset),
            not who actually approved it or what their role was. */}
        <ApprovalStatusPanel
          supervisorStatus={details.supervisor_status}
          supervisorApprovedByName={details.supervisor_name || details.supervisor_approved_by_name}
          supervisorApprovedByRole={details.supervisor_approved_by_role}
          supervisorApprovedAt={details.supervisor_approved_at}
          custodianStatus={details.custodian_status}
          custodianApprovedByName={details.custodian_name || details.custodian_approved_by_name}
          custodianApprovedByRole={details.custodian_approved_by_role}
          custodianApprovedAt={details.custodian_approved_at}
          rejectionComment={details.rejection_comment}
        />

        {/* Purchase Request */}
        <div className="border rounded p-3 mb-3">
          <div className="fw-semibold text-secondary small text-uppercase mb-3">Purchase Request</div>
          <div className="row g-3">
            <div className="col-12 col-sm-6">
              <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>PR Number</label>
              <input type="text" className="form-control form-control-sm" placeholder="PR Number" value={details.pr_number || ""} onChange={(e) => updateRequestDetail(row.id, "pr_number", e.target.value)} />
            </div>
            <div className="col-12 col-sm-6">
              <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>Order Status</label>
              <select className="form-select form-select-sm" value={details.pr_status || "pending"} onChange={(e) => updateRequestDetail(row.id, "pr_status", e.target.value)}>
                <option value="pending">Pending</option>
                <option value="finish">Finish</option>
              </select>
            </div>
            {details.pr_number_updated_by_name && (
              <>
                <div className="col-12 col-sm-6">
                  <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>Custodian (Entered By)</label>
                  <div>{details.pr_number_updated_by_name}</div>
                </div>
                <div className="col-12 col-sm-6">
                  <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>Date Entered</label>
                  <div>{details.pr_number_updated_at ? new Date(details.pr_number_updated_at).toISOString().split("T")[0] : "—"}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Supervisor Action */}
        {isAdmin && (
          <div className="border rounded p-3 mb-3">
            <div className="fw-semibold text-secondary small text-uppercase mb-2">Supervisor Action</div>
            {details.supervisor_status && details.supervisor_status !== "pending" ? (
              <div className="d-flex align-items-center gap-2">
                <span className={`badge fs-6 ${getBsStatusBadgeClass(details.supervisor_status)}`}>{formatStatusLabel(details.supervisor_status)}</span>
                <button onClick={() => handleResetApproval(row.id, "service", "supervisor")} className="btn btn-sm btn-outline-danger">
                  <i className="bi bi-arrow-counterclockwise me-1"></i>Reset to Pending
                </button>
              </div>
            ) : (
              <div className="d-flex gap-2">
                <button onClick={() => handleSupervisorAction(row, "approve")} className="btn btn-success btn-sm w-100">Approve</button>
                <button onClick={() => handleSupervisorAction(row, "reject")} className="btn btn-outline-danger btn-sm w-100">Decline</button>
              </div>
            )}
          </div>
        )}

        {/* Custodian Action */}
        <div className="border rounded p-3 mb-3">
          <div className="fw-semibold text-secondary small text-uppercase mb-2">Custodian Action</div>
          {details.custodian_status && details.custodian_status !== "pending" ? (
            <div className="d-flex align-items-center gap-2">
              <span className={`badge fs-6 ${getBsStatusBadgeClass(details.custodian_status)}`}>{formatStatusLabel(details.custodian_status)}</span>
              {isAdmin && (
                <button onClick={() => handleResetApproval(row.id, "service", "custodian")} className="btn btn-sm btn-outline-danger">
                  <i className="bi bi-arrow-counterclockwise me-1"></i>Reset to Pending
                </button>
              )}
            </div>
          ) : isReadOnlyRole ? (
            <span className="badge fs-6 bg-warning text-dark">Pending</span>
          ) : (
            <button onClick={() => handleStatusClick(row)} className="btn btn-primary btn-sm w-100">
              <i className="bi bi-check2-circle me-1"></i>Approve / Decline
            </button>
          )}
        </div>
        <hr className="my-3" />
        <h5 className="mb-3">Services</h5>
        <div className="table-responsive">
          <table className="table table-sm" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
            <thead style={{ backgroundColor: "#f8f9fa" }}>
              <tr>
                <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", width: "36px" }}>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    title="Select all services"
                    disabled={!isApproved}
                    checked={
                      serviceRows.length > 0 &&
                      getServiceSelection(row.id).size === serviceRows.length
                    }
                    onChange={() => toggleSelectAllServices(row.id, serviceRows.length)}
                  />
                </th>
                <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>#</th>
                <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Description</th>
                <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Status</th>
                <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Receiving Report No.</th>
              </tr>
            </thead>
            <tbody>
              {serviceRows.map((service, index) => (
                <tr key={index} style={{ backgroundColor: getServiceSelection(row.id).has(index) ? "#e7f1ff" : index % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                  <td className={styles.serviceCell}>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      disabled={!isApproved}
                      checked={getServiceSelection(row.id).has(index)}
                      onChange={() => toggleServiceSelected(row.id, index)}
                    />
                  </td>
                  <td className={styles.serviceCell}>{index + 1}</td>
                  <td className={styles.serviceCell}>
                    {isAdmin ? (
                      <input type="text" className="form-control form-control-sm text-uppercase" value={service.description || ""} onChange={(e) => updateService(row.id, index, "description", e.target.value.toUpperCase())} />
                    ) : (service.description || "-")}
                  </td>
                  <td className={styles.serviceCell}>
                    <select
                      className="form-select form-select-sm"
                      value={service.delivery_status || "pending"}
                      disabled={!isApproved}
                      onChange={(e) => updateSelectedService(row.id, index, "delivery_status", e.target.value)}
                    >
                      <option value="pending">Pending</option>
                      <option value="holded">{service.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                      <option value="completed">Completed</option>
                    </select>
                  </td>
                  <td className={styles.serviceCellLast}>
                    {service.delivery_status === "completed" ? (
                      <>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="Receiving Report No."
                          disabled={!isApproved}
                          value={service.receiving_report_no || ""}
                          onChange={(e) => updateSelectedService(row.id, index, "receiving_report_no", e.target.value)}
                        />
                        {service.receiving_report_no_updated_by_name && (
                          <div className="text-muted mt-1 d-flex align-items-center gap-1" style={{ fontSize: "0.72rem" }}>
                            <span>
                              By {service.receiving_report_no_updated_by_name}
                              {service.receiving_report_no_updated_at && ` · ${new Date(service.receiving_report_no_updated_at).toISOString().split("T")[0]}`}
                            </span>
                            {isApproved && service.id !== undefined && (
                              <button
                                type="button"
                                className="btn btn-link btn-sm p-0 text-danger"
                                style={{ fontSize: "0.85rem", lineHeight: 1 }}
                                title="Clear Receiving Report No. and its entry history"
                                onClick={() => setDeleteTarget({ requestId: row.id, entityId: service.id!, type: "rr" })}
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 d-flex justify-content-end">
          {hasServiceChanges.has(row.id) && (
            <button className="btn btn-primary btn-sm" onClick={() => handleSaveServiceUpdates(row.id)}>
              <i className="bi bi-save me-1"></i>Save Service Updates
            </button>
          )}
        </div>
      </div>
    );
  };

  // Pending requests always sort above every other status first; within each
  // of those two groups, most-recent-first — then capped to 20 for display.
  const isPendingStatus = (status?: string) => (status || "").toLowerCase().trim() === "pending";
  const byMostRecent = <T extends { created_at: string; status?: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => {
      const pendingDiff = Number(isPendingStatus(b.status)) - Number(isPendingStatus(a.status));
      if (pendingDiff !== 0) return pendingDiff;
      return b.created_at.localeCompare(a.created_at);
    });

  // Department + date-range filter, applied once and reused for the tab
  // badges, the rendered rows, and the department-dropdown-driven counts —
  // so they all agree. The tab badge counts every matching request (the true
  // total), not just the 20 rows the table actually renders below it.
  const matchingItemRequests = filterByDateRange(
    filterByDepartment(filteredItemRequests, selectedDepartment), startDate, endDate, "created_at"
  );
  const matchingServiceRequests = filterByDateRange(
    filterByDepartment(filteredServiceRequests, selectedDepartment), startDate, endDate, "created_at"
  );
  const visibleItemRequests = byMostRecent(matchingItemRequests).slice(0, 20);
  const visibleServiceRequests = byMostRecent(matchingServiceRequests).slice(0, 20);

  // Exports the full filtered set for the active tab, not just the 20 rows
  // rendered below it — mirrors HeldItemsPage/PendingItemsPage's export.
  const handleExport = () =>
    activeTab === "item"
      ? exportToExcel(
          "pending-item-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "Status" },
          ],
          matchingItemRequests.map((row) => ({
            serial: row.serial || "",
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
            created_by: row.created_by || "",
            department: row.department || "",
            purpose: row.purpose || "",
            status: getCompositeStatus(row as unknown as Record<string, unknown>).text,
          }))
        )
      : exportToExcel(
          "pending-service-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "Status" },
          ],
          matchingServiceRequests.map((row) => ({
            serial: row.serial || "",
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
            created_by: row.created_by || "",
            department: row.department || "",
            purpose: row.purpose || "",
            status: getCompositeStatus(row as unknown as Record<string, unknown>).text,
          }))
        );

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Custodian Dashboard</h1>
        <p className="page-subtitle">All Departments — Request Management</p>
      </div>

      <div className="dash-toolbar">
        <div className="dash-tabs">
          <button
            className={`dash-tab ${!activeUrgentTab && activeTab === "item" ? "active" : ""}`}
            onClick={() => { setActiveUrgentTab(false); setActiveTab("item"); }}
          >
            Item Requests
            <span className="dash-tab-badge">{matchingItemRequests.length}</span>
          </button>
          <button
            className={`dash-tab ${!activeUrgentTab && activeTab === "service" ? "active" : ""}`}
            onClick={() => { setActiveUrgentTab(false); setActiveTab("service"); }}
          >
            Service Requests
            <span className="dash-tab-badge">{matchingServiceRequests.length}</span>
          </button>
          <button
            className={`dash-tab ${activeUrgentTab ? "active" : ""}`}
            onClick={() => setActiveUrgentTab(true)}
          >
            Urgent Requests
            <span className="dash-tab-badge">
              {urgentRequests.filter((r) => r.stockroom_status === "pending").length}
            </span>
          </button>

        </div>
      </div>

      {!activeUrgentTab && (
        <>
          <ListToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by Serial, Purpose, PR Number..."
            onExport={handleExport}
            exportDisabled={(activeTab === "item" ? matchingItemRequests : matchingServiceRequests).length === 0}
          />

          <div className="mb-4 d-flex align-items-end gap-3 flex-wrap">
            <div>
              <label className="form-label fw-bold">Filter by Department:</label>
              <select
                className="form-select"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
              >
                <option value="all">All Departments</option>
                {(activeTab === "item" ? getUniqueDepartments(itemRequests) : getUniqueDepartments(serviceRequests)).map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            <DateRangeFilter />
          </div>

          <div className={styles.requestListFrame}>
            {/* Column header bar */}
            <div className={styles.requestListHeader}>
              <div></div>
              <div>Serial Number</div>
              <div>Created Date</div>
              <div>Created By</div>
              <div>Department</div>
              <div>Purpose</div>
              <div>Status</div>
            </div>

            {activeTab === "item" ? (
              <div>
                {visibleItemRequests
                  .map((row) => (
                    <div key={row.id} className={styles.requestCard}>
                      {renderSummaryRow(row)}
                      <div className={`${styles.expandWrapper} ${expandedRows.has(makeRequestKey("item", row.id)) ? styles.expandWrapperOpen : ""}`}>
                        <div className={styles.expandInner}>
                          {requestDetails.has(makeRequestKey("item", row.id)) && renderItemDetail(row)}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div>
                {visibleServiceRequests
                  .map((row) => (
                    <div key={row.id} className={styles.requestCard}>
                      {renderSummaryRow(row)}
                      <div className={`${styles.expandWrapper} ${expandedRows.has(makeRequestKey("service", row.id)) ? styles.expandWrapperOpen : ""}`}>
                        <div className={styles.expandInner}>
                          {requestDetails.has(makeRequestKey("service", row.id)) && renderServiceDetail(row)}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
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
            {loadingUrgentRequests && <div className="p-3 text-muted">Loading urgent requests...</div>}
            {!loadingUrgentRequests && urgentRequests.length === 0 && (
              <div className="p-3 text-muted">No urgent requests.</div>
            )}
            {urgentRequests.map((row) => {
              const expanded = expandedUrgentIds.has(row.id);
              return (
                <div key={row.id} className={styles.requestCard}>
                  <div
                    className={`${styles.urgentListRow} ${expanded ? styles.urgentListRowExpanded : ""}`}
                    onClick={() => toggleUrgentRow(row.id)}
                  >
                    <div className="text-center">
                      <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                    </div>
                    <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                    <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                    <div data-label="Dept">{row.department}</div>
                    <div data-label="Purpose">{row.purpose}</div>
                    <div data-label="Status">
                      <span className={`badge ${getBsStatusBadgeClass(row.stockroom_status)}`}>
                        {formatStatusLabel(row.stockroom_status)}
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
                                    <td>
                                      <button
                                        type="button"
                                        className={`btn btn-sm ${item.is_inventoriable ? "btn-success" : "btn-outline-secondary"}`}
                                        disabled={!item.id || savingItemInventoriableId === item.id || isReadOnlyRole}
                                        onClick={() => item.id && setItemInventoriable(row.id, item.id, !item.is_inventoriable)}
                                        title="Only Stockroom (Custodian) can classify this — click to toggle"
                                      >
                                        {item.is_inventoriable ? "Yes" : "No"}
                                      </button>
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

                            {row.stockroom_status === "pending" && !isReadOnlyRole && (
                              <div className="d-flex gap-2">
                                <button
                                  className="btn btn-sm btn-success"
                                  onClick={() => reviewUrgentRequest(row.id, "approved")}
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

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setRejectionComment(""); }} title="Custodian Approval">
        <div className="container-fluid">
          <div className="row mb-3">
            <div className="col-6"><strong>Serial:</strong> {selectedRequest?.serial}</div>
            <div className="col-6"><strong>Department:</strong> {selectedRequest?.department}</div>
          </div>
          <div className="mb-3">
            <label className="form-label">Status</label>
            <select className="form-select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              <option value="approved">Approved</option>
              <option value="rejected">Declined</option>
            </select>
          </div>
          {newStatus === "rejected" && (
            <div className="mb-3">
              <label className="form-label">Declined Comment</label>
              <textarea
                className="form-control"
                value={rejectionComment}
                onChange={(e) => setRejectionComment(e.target.value.toUpperCase())}
                placeholder="Please provide a reason for declining..."
                rows={3}
                required
              />
            </div>
          )}
          <div className="modal-footer d-flex justify-content-end gap-2">
            <button onClick={handleStatusUpdate} className="btn btn-primary">Submit</button>
          </div>
        </div>
      </Modal>

      <DeleteReasonModal
        isOpen={deleteTarget !== null}
        title={
          deleteTarget?.type === "audit" ? "Delete Issuance Record" :
          "Clear Receiving Report No."
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget) {
            if (deleteTarget.type === "rr") handleClearReceivingReport(deleteTarget.requestId, deleteTarget.entityId, reason);
            else handleDeleteAudit(deleteTarget.requestId, deleteTarget.entityId, reason);
          }
          setDeleteTarget(null);
        }}
      />

      <DeleteReasonModal
        isOpen={urgentDeclineTarget !== null}
        title="Decline Urgent Request"
        onClose={() => setUrgentDeclineTarget(null)}
        onConfirm={(reason) => {
          if (urgentDeclineTarget !== null) reviewUrgentRequest(urgentDeclineTarget, "rejected", reason);
          setUrgentDeclineTarget(null);
        }}
      />

      {showItemCatalogModal && (
        <React.Suspense fallback={null}>
          <ItemCatalogModal isOpen={showItemCatalogModal} onClose={() => setShowItemCatalogModal(false)} />
        </React.Suspense>
      )}

      <AdjustmentHistoryModal
        isOpen={historyRequestId !== null}
        onClose={() => setHistoryRequestId(null)}
        requestId={historyRequestId}
      />
    </Layout>
  );
};

export default CustodianDashboard;
