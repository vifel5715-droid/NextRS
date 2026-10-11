import React, { useState } from "react";
import { useCompleteRequestsManagement } from "@features/requests/hooks/useCompleteRequestsManagement";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import { useAuth } from "@app/providers/AuthProvider";
import { itemRequestAPI } from "../../../services/api";
import { openAttachment } from "@shared/utils/openAttachment";
import { getCompositeStatus, getStatusBadgeClass, getItemStatusText, getItemStatusBadgeClass, getServiceStatusText, getServiceStatusBadgeClass } from "@shared/utils/status";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import { copyToClipboard, formatItemsForClipboard, formatItemsForProjectGrid } from "@shared/utils/clipboard";
import { UOM_OPTIONS } from "../../../constants/uom";
import { makeRequestKey } from "@shared/utils/requestKey";
import type { ItemRequest, ServiceRequest, ItemRow, ServiceRow, ItemAudit, FieldValue } from "@shared/types";
import Layout from "@shared/components/Layout";
import IssuanceHistory from "@features/requests/components/IssuanceHistory";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import AdjustmentHistoryModal from "@features/adjustments/components/AdjustmentHistoryModal";
import ApprovalStatusPanel from "@features/requests/components/ApprovalStatusPanel";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { ItemExistenceBadge } from "@shared/components/ItemExistenceStatus";
import { useItemCatalogNames } from "@features/item-catalog/hooks/useItemCatalogNames";
import { getItemExistenceStatus } from "@shared/utils/itemExistenceStatus";
import { getItemBalance } from "@shared/utils/itemBalance";
import { formatMilitaryTime } from "@shared/utils/format";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import ListToolbar from "@shared/components/ListToolbar";
import { exportToExcel } from "@shared/utils/exportExcel";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import type { UrgentRequest, ReimbursementRequest } from "@shared/types";
import styles from "./Dashboard.module.css";

const CompleteRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isAdmin = role === "admin";
  const isCustodian = role === "custodian" || isAdmin;
  const itemCatalogNames = useItemCatalogNames();
  const machineCodeOptions = useMachineCodeOptions();

  const {
    activeTab,
    setActiveTab,
    loading,
    filteredItemRequests,
    filteredServiceRequests,
    filteredUrgentRequests,
    filteredReimbursementRequests,
    handleDeleteInRange,
    searchQuery,
    setSearchQuery,
    expandedRows,
    requestDetails,
    hasServiceChanges,
    dirtyItemIds,
    editableServices,
    handleRowClick,
    updateItemField,
    handleSaveItem,
    handleDeleteItem,
    handleDeleteService,
    handleDeleteAudit,
    updateRequestDetail,
    updateService,
    updateServiceIndexes,
    handleSaveServiceUpdates,
    handleClearReceivingReport,
  } = useCompleteRequestsManagement();

  // Capped to 20 — mirrors CustodianDashboard's Pending Requests list, so
  // this page stays readable as completed requests pile up. The tab badge is
  // just this capped list's length, so it never claims a bigger number than
  // what's actually shown below.
  //
  // Sorted by Created Date, most recent first — the API's own order (most-
  // recent-ACTIVITY-first, see item-request.controller.ts) is overridden here
  // so the list always matches the visible "Created Date" column.
  const byMostRecent = <T extends { created_at: string },>(rows: T[]): T[] =>
    [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
  const visibleItemRequests = byMostRecent(filteredItemRequests);
  const visibleServiceRequests = byMostRecent(filteredServiceRequests);
  const visibleUrgentRequests = byMostRecent(filteredUrgentRequests);
  const visibleReimbursementRequests = byMostRecent(filteredReimbursementRequests);

  const { startDate, endDate } = useDateRangeContext();
  const TAB_LABELS = { item: "Item", service: "Service", urgent: "Urgent", reimbursement: "Reimbursement" } as const;
  const activeFilteredRows: { id: number }[] =
    activeTab === "item" ? filteredItemRequests :
    activeTab === "service" ? filteredServiceRequests :
    activeTab === "urgent" ? filteredUrgentRequests :
    filteredReimbursementRequests;
  const [deletingInRange, setDeletingInRange] = useState(false);

  // Admin-only bulk delete of the active tab's completed requests in the
  // chosen Start/End Date range. Both dates are required so an empty range
  // ("all time") can never wipe the whole list by accident.
  const confirmDeleteInRange = async () => {
    if (!startDate || !endDate) {
      alert("Set both Start Date and End Date before deleting.");
      return;
    }
    const count = activeFilteredRows.length;
    if (count === 0) return;
    const label = `${TAB_LABELS[activeTab]} Request${count === 1 ? "" : "s"}`;
    const typed = window.prompt(
      `This will PERMANENTLY delete ${count} completed ${label} created from ${startDate} to ${endDate}` +
      (searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : "") +
      `, including all of their items and history. This cannot be undone.\n\nType DELETE to confirm.`
    );
    if (typed?.trim().toUpperCase() !== "DELETE") return;
    setDeletingInRange(true);
    try {
      await handleDeleteInRange();
    } finally {
      setDeletingInRange(false);
    }
  };

  // Urgent/Reimbursement rows carry their items inline, so expanding one is
  // purely local — no detail fetch like item/service rows.
  const [expandedSpecial, setExpandedSpecial] = useState<string | null>(null);
  const toggleSpecial = (key: string) => setExpandedSpecial((prev) => (prev === key ? null : key));

  // Full filtered set, sorted the same way as the capped on-screen list —
  // so the export always matches what's currently visible, just uncapped.
  const sortByDate = <T extends { created_at: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const exportSpecial = () =>
    activeTab === "urgent"
      ? exportToExcel(
          "complete-urgent-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "requested_by", label: "Requested By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "items", label: "Items" },
          ],
          sortByDate(filteredUrgentRequests).map((req) => ({
            serial: req.serial || "",
            date: req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : "",
            requested_by: req.requested_by || req.created_by || "",
            department: req.department || "",
            purpose: req.purpose || "",
            items: req.items.map((i) => `${i.item_description} (${i.quantity ?? ""} ${i.uom ?? ""})`.trim()).join("; "),
          }))
        )
      : exportToExcel(
          "complete-reimbursement-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "requested_by", label: "Requested By" },
            { key: "department", label: "Department" },
            { key: "supplier", label: "Supplier" },
            { key: "purpose", label: "Purpose" },
            { key: "total", label: "Total Cost" },
          ],
          sortByDate(filteredReimbursementRequests).map((req) => ({
            serial: req.serial || "",
            date: req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : "",
            requested_by: req.requested_by || req.created_by || "",
            department: req.department || "",
            supplier: req.supplier || "",
            purpose: req.purpose || "",
            total: req.total_cost,
          }))
        );

  const handleExport = () =>
    activeTab === "urgent" || activeTab === "reimbursement" ? exportSpecial() :
    activeTab === "item"
      ? exportToExcel(
          "complete-item-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "IRS Status" },
          ],
          sortByDate(filteredItemRequests).map((req) => ({
            serial: req.serial || "",
            date: req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : "",
            created_by: req.created_by || "",
            department: req.department || "",
            purpose: req.purpose || "",
            status: getCompositeStatus(req as unknown as Record<string, unknown>).text,
          }))
        )
      : exportToExcel(
          "complete-service-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "SRS Status" },
          ],
          sortByDate(filteredServiceRequests).map((req) => ({
            serial: req.serial || "",
            date: req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : "",
            created_by: req.created_by || "",
            department: req.department || "",
            purpose: req.purpose || "",
            status: "SERVICE FINISHED",
          }))
        );

  // Which item/service is queued for deletion, pending a typed reason —
  // see DeleteReasonModal below.
  const [deleteTarget, setDeleteTarget] = useState<{ requestId: number; entityId: number; type: "item" | "service" | "audit" | "rr" } | null>(null);

  // Which item request's Adjustment History modal is open, if any.
  const [historyRequestId, setHistoryRequestId] = useState<number | null>(null);

  // Bulk selection, kept per request so two expanded requests never share a
  // selection — mirrors CustodianDashboard's Pending Requests items table.
  const [selectedItems, setSelectedItems] = useState<Map<number, Set<number>>>(new Map());
  const getSelection = (requestId: number): Set<number> => selectedItems.get(requestId) ?? new Set<number>();
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
      if (current && current.size === itemIds.length) next.delete(requestId);
      else next.set(requestId, new Set(itemIds));
      return next;
    });
  };
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

  const [selectedServices, setSelectedServices] = useState<Map<number, Set<number>>>(new Map());
  const getServiceSelection = (requestId: number): Set<number> => selectedServices.get(requestId) ?? new Set<number>();
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
  const updateSelectedService = (requestId: number, index: number, field: string, value: FieldValue) => {
    const selection = getServiceSelection(requestId);
    const targets = selection.has(index) ? Array.from(selection) : [index];
    updateServiceIndexes(requestId, targets, field, value);
  };

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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

  const handleDownloadAttachment = (id: number) => openAttachment(itemRequestAPI.attachmentUrl(id));

  const renderItemRow = (req: ItemRequest) => {
    const key = makeRequestKey("item", req.id);
    const isExpanded = expandedRows.has(key);
    const detail = requestDetails.get(key);
    const items: ItemRow[] = detail?.items ?? [];
    const itemIds = items.map((i) => i.id).filter((id): id is number => id !== undefined);
    const isApproved = detail?.custodian_status === "approved" || isAdmin;

    return (
      <div key={req.id} className={styles.requestCard}>
        <div
          className={`${styles.requestCardRow} ${isExpanded ? styles.requestCardRowExpanded : ""}`}
          onClick={() => handleRowClick(req)}
        >
          <div className="text-center">
            <i className={`bi bi-chevron-${isExpanded ? "down" : "right"}`}></i>
          </div>
          <div className="fw-medium" data-label="Serial">{req.serial}</div>
          <div className="text-muted" data-label="Date">
            {req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : ""}
          </div>
          <div className="hide-sm" data-label="By">{req.created_by}</div>
          <div className="hide-sm" data-label="Dept">{req.department}</div>
          <div data-label="Purpose">{req.purpose}</div>
          <div>
            {(() => {
              const s = getCompositeStatus(req as unknown as Record<string, unknown>);
              return <span className={`badge ${getStatusBadgeClass(s.class)}`}>{s.text}</span>;
            })()}
          </div>
        </div>
        <div className={`${styles.expandWrapper} ${isExpanded ? styles.expandWrapperOpen : ""}`}>
          <div className={styles.expandInner}>
            {detail && (
              <div className={styles.requestCardBody}>
                <div className="p-3">
                  <h5 className="mb-3">Request Details</h5>

                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <button onClick={async () => { const { printoutslip } = await import("@features/requests/utils/printout"); printoutslip(detail, "item"); }} className="btn btn-sm btn-primary" title="Print Out Slip">
                      <i className="bi bi-printer me-1"></i>Print Out Slip
                    </button>
                    <button onClick={() => setHistoryRequestId(req.id)} className="btn btn-sm btn-primary" title="Adjustment History">
                      <i className="bi bi-clock-history me-1"></i>Adjustment History
                    </button>
                  </div>

                  <div className="border rounded p-3 mb-3 bg-light">
                    <div className="fw-semibold text-secondary small text-uppercase mb-3">Request Information</div>
                    <div className="row g-3">
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Serial</div>
                        <div className="fw-semibold">{detail.serial}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Created Time</div>
                        <div className="fw-semibold">{formatMilitaryTime(detail.created_at)}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Department</div>
                        <div className="fw-semibold">{detail.department}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Requested By</div>
                        <div className="fw-semibold">{sanitizeUserInput(detail.requested_by || "—")}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
                        <span className={`badge ${getStatusBadgeClass(detail.status)}`}>{detail.status}</span>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
                        <div>{sanitizeUserInput(detail.remarks || "—")}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
                        <div>{sanitizeUserInput(detail.purpose || "—")}</div>
                      </div>
                      {detail.attachment_name && (
                        <div className="col-12 col-sm-6 col-md">
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>Attachment</div>
                          <button type="button" className="btn btn-link p-0" onClick={() => handleDownloadAttachment(req.id)}>
                            <i className="bi bi-file-earmark-pdf me-1"></i>
                            {sanitizeUserInput(detail.attachment_name)}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <ApprovalStatusPanel
                    supervisorLabel="Supervisor And Manager"
                    supervisorStatus={detail.supervisor_status}
                    supervisorApprovedByName={detail.supervisor_name || detail.supervisor_approved_by_name}
                    supervisorApprovedAt={detail.supervisor_approved_at}
                    custodianStatus={detail.custodian_status}
                    custodianApprovedByName={detail.custodian_name || detail.custodian_approved_by_name}
                    custodianApprovedAt={detail.custodian_approved_at}
                  />

                  <hr className="my-3" />
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <h5 className="mb-0">Items</h5>
                    {isCustodian && (() => {
                      const selection = getSelection(req.id);
                      const rowsToCopy = selection.size > 0 ? items.filter((i) => i.id !== undefined && selection.has(i.id)) : items;
                      const copyKey = `items-${req.id}`;
                      const projectCopyKey = `items-project-${req.id}`;
                      return (
                        <>
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            title="Copy Item Name, Quantity, UoM and Machine Code — paste straight into a spreadsheet or another system's grid"
                            disabled={rowsToCopy.length === 0}
                            onClick={() => copyItems(copyKey, rowsToCopy)}
                          >
                            <i className={`bi ${copiedKey === copyKey ? "bi-check2" : "bi-clipboard"} me-1`}></i>
                            {copiedKey === copyKey ? "Copied" : selection.size > 0 ? `Copy ${selection.size} selected` : "Copy all"}
                          </button>
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            title="Copy Item Description, Serial No., Required Qty., UoM Code and Project (Machine Code) — paste straight into the Item No./Item Description/Serial No./Required Date/Required Qty./UoM Code/Project grid"
                            disabled={rowsToCopy.length === 0}
                            onClick={() => copyItemsForProjectGrid(projectCopyKey, rowsToCopy, req.serial)}
                          >
                            <i className={`bi ${copiedKey === projectCopyKey ? "bi-check2" : "bi-clipboard"} me-1`}></i>
                            {copiedKey === projectCopyKey ? "Copied" : "Copy for Project grid"}
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {isCustodian ? (
                    <div className="table-responsive">
                      <table className={`table table-sm ${styles.itemsTable}`} style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                        <thead style={{ backgroundColor: "#f8f9fa" }}>
                          <tr>
                            <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", width: "36px" }}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                title="Select all items"
                                disabled={!isApproved}
                                checked={itemIds.length > 0 && getSelection(req.id).size === itemIds.length}
                                onChange={() => toggleSelectAll(req.id, itemIds)}
                              />
                            </th>
                            {["#", "Item Name", "Quantity", "UoM", "Remarks", "Machine Code", "Balance", "Existence Status", "Status", "Details", "Actions"].map((h) => (
                              <th key={h} style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, index) => {
                            const audits: ItemAudit[] = item.audits || [];
                            const outstandingToDeliver = Math.max(0, (item.quantity || 0) - (item.quantity_delivered || 0));
                            const outstandingToRelease = Math.max(0, (item.quantity || 0) - (item.quantity_out || 0));
                            const itemId = item.id ?? -1;
                            const isSelected = getSelection(req.id).has(itemId);
                            const existenceStatus = getItemExistenceStatus(item.item_name, itemCatalogNames);
                            // A blank name gets the same treatment as "not_found" (which
                            // getItemExistenceStatus can't itself report — an empty query
                            // is null, not not_found) so a cleared name isn't a dead end
                            // only admin can recover from. A row already mid-edit stays
                            // editable regardless of what the live-typed name resolves to
                            // — see CustodianDashboard's canEditItemName for the fuller
                            // rationale on both.
                            const isRowDirty = item.id !== undefined && dirtyItemIds.has(item.id);
                            // See CustodianDashboard's isHeldLocked for the full rationale —
                            // custodian loses edit access to a HOLD item entirely; admin is
                            // exempt.
                            const isHeldLocked = item.delivery_status === "HOLD" && !isAdmin;
                            const canEditItemName = !isHeldLocked && (isAdmin || isRowDirty || existenceStatus === "not_found" || !item.item_name?.trim());
                            return (
                              <tr key={index} style={{ backgroundColor: isSelected ? "#e7f1ff" : index % 2 === 0 ? "#ffffff" : "#f8f9fa" }}>
                                <td data-label="Select" style={{ padding: "12px", border: "none" }}>
                                  <input type="checkbox" className="form-check-input" disabled={!isApproved || isHeldLocked} checked={isSelected} onChange={() => toggleItemSelected(req.id, itemId)} />
                                </td>
                                <td data-label="#" style={{ padding: "12px", border: "none" }}>{index + 1}</td>
                                <td data-label="Item Name" style={{ padding: "12px", border: "none" }}>
                                  {canEditItemName ? (
                                    <SearchableCombobox
                                      className="form-control form-control-sm text-uppercase"
                                      value={item.item_name || ""}
                                      onChange={(value) => updateItemField(req.id, index, "item_name", value.toUpperCase())}
                                      options={itemCatalogNames}
                                      placeholder="Search or type item name…"
                                      onEnter={item.id !== undefined ? () => handleSaveItem(req.id, item.id!) : undefined}
                                    />
                                  ) : item.item_name}
                                </td>
                                <td data-label="Qty" style={{ padding: "12px", border: "none" }}>
                                  {isAdmin && !isHeldLocked ? (
                                    <input type="number" min="1" className="form-control form-control-sm" style={{ width: "90px" }} value={item.quantity ?? ""} onChange={(e) => updateItemField(req.id, index, "quantity", Math.max(1, parseInt(e.target.value) || 1))} onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(req.id, item.id); } }} />
                                  ) : item.quantity}
                                </td>
                                <td data-label="UoM" style={{ padding: "12px", border: "none" }}>
                                  {isAdmin && !isHeldLocked ? (
                                    <select className="form-select form-select-sm text-uppercase" style={{ width: "110px" }} aria-label={`UoM for ${item.item_name || `item ${index + 1}`}`} value={(UOM_OPTIONS as readonly string[]).includes(item.uom) ? item.uom : ""} onChange={(e) => updateItemField(req.id, index, "uom", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(req.id, item.id); } }}>
                                      <option value="" disabled>Select UoM</option>
                                      {UOM_OPTIONS.map((uom) => (<option key={uom} value={uom}>{uom}</option>))}
                                    </select>
                                  ) : item.uom}
                                </td>
                                <td data-label="Remarks" style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(item.remarks || "N/A")}</td>
                                <td data-label="Machine Code" style={{ padding: "12px", border: "none" }}>
                                  {isAdmin && !isHeldLocked ? (
                                    <SearchableCombobox
                                      className="form-control form-control-sm text-uppercase"
                                      value={item.machine_code || ""}
                                      onChange={(value) => updateItemField(req.id, index, "machine_code", value)}
                                      options={machineCodeOptions.options}
                                      descriptions={machineCodeOptions.descriptions}
                                      placeholder="Search or type…"
                                      noResultsText="No record found"
                                      onEnter={item.id !== undefined ? () => handleSaveItem(req.id, item.id!) : undefined}
                                    />
                                  ) : sanitizeUserInput(item.machine_code || "N/A")}
                                </td>
                                <td data-label="Balance" style={{ padding: "12px", border: "none" }}>
                                  {getItemBalance(
                                    item,
                                    item.issuance_number?.trim()
                                      ? item.quantity_out_now ?? outstandingToRelease
                                      : 0
                                  )}
                                </td>
                                <td data-label="Existence Status" style={{ padding: "12px", border: "none" }}>
                                  <ItemExistenceBadge status={existenceStatus} />
                                </td>
                                <td data-label="Status" style={{ padding: "12px", border: "none" }}>
                                  {/* Custodian keeps full control of Status even once an item is HOLD —
                                      see CustodianDashboard's Status cell for the fuller rationale. */}
                                  <select className="form-select form-select-sm w-100" value={item.delivery_status || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "delivery_status", e.target.value)}>
                                    <option value="">Select Status</option>
                                    <option value="OUT">OUT</option>
                                    <option value="PURCHASE REQUEST">PURCHASE REQUEST</option>
                                    <option value="URGENT">URGENT</option>
                                    <option value="HOLD">{item.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                                  </select>
                                </td>
                                <td data-label="Details" style={{ padding: "12px", border: "none" }}>
                                  {item.delivery_status ? (
                                    <div className="table-responsive">
                                      <table className="table table-sm mb-0" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #dee2e6", borderRadius: "6px", overflow: "hidden", backgroundColor: "#fafbfc" }}>
                                        <tbody>
                                          {item.delivery_status === "OUT" && outstandingToRelease > 0 && (
                                            <>
                                              <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Issuance No.</td>
                                                <td style={{ padding: "8px 12px", border: "none" }}>
                                                  <input type="text" className="form-control form-control-sm" placeholder="Issuance Number" value={item.issuance_number || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "issuance_number", e.target.value)} />
                                                </td>
                                              </tr>
                                              <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Qty Out</td>
                                                <td style={{ padding: "8px 12px", border: "none" }}>
                                                  <input type="number" min="0" max={outstandingToRelease} className="form-control form-control-sm" placeholder={`Qty Out (max ${outstandingToRelease})`} value={item.quantity_out_now ?? outstandingToRelease} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "quantity_out_now", e.target.value === "" ? undefined : parseInt(e.target.value) || 0)} />
                                                </td>
                                              </tr>
                                            </>
                                          )}
                                          {(item.delivery_status === "PURCHASE REQUEST" || item.delivery_status === "URGENT") && (
                                            <>
                                              <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>{item.delivery_status === "URGENT" ? "Date Needed" : "PR Number"}</td>
                                                <td style={{ padding: "8px 12px", border: "none" }}>
                                                  {item.delivery_status === "URGENT" ? (
                                                    <input type="date" className="form-control form-control-sm" value={item.date_needed || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "date_needed", e.target.value)} />
                                                  ) : (
                                                    <input type="text" className="form-control form-control-sm" placeholder="PR Number" value={item.pr_number || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "pr_number", e.target.value)} />
                                                  )}
                                                </td>
                                              </tr>
                                              <tr style={{ borderBottom: item.pr_status === "DELIVERED PARTIAL" ? "1px solid #dee2e6" : "none" }}>
                                                <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Order Status</td>
                                                <td style={{ padding: "8px 12px", border: "none" }}>
                                                  <select className="form-select form-select-sm" value={item.pr_status || ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "pr_status", e.target.value)}>
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
                                              <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>Qty Delivered</td>
                                              <td style={{ padding: "8px 12px", border: "none" }}>
                                                <input type="number" min="0" max={outstandingToDeliver} className="form-control form-control-sm" placeholder={`Quantity (max ${outstandingToDeliver})`} value={item.quantity_delivered_now ?? ""} disabled={!isApproved} onChange={(e) => updateSelectedItemField(req.id, index, item, items, "quantity_delivered_now", e.target.value === "" ? undefined : parseInt(e.target.value) || 0)} />
                                              </td>
                                            </tr>
                                          )}
                                          {audits.length > 0 && (
                                            <tr>
                                              <td colSpan={2} style={{ padding: "0", border: "none" }}>
                                                <IssuanceHistory audits={audits} prNumber={(item.pr_type || item.delivery_status) === "URGENT" ? (item.date_needed ? new Date(item.date_needed).toLocaleDateString() : null) : item.pr_number} prNumberLabel={(item.pr_type || item.delivery_status) === "URGENT" ? "Date Needed" : "PR Number"} showPrNumber={isCustodian} onDelete={(auditId) => setDeleteTarget({ requestId: req.id, entityId: auditId, type: "audit" })} />
                                              </td>
                                            </tr>
                                          )}
                                          {item.delivery_status === "DELIVERED" && (
                                            <tr><td colSpan={2} className="text-center">-</td></tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : <span className="text-muted">-</span>}
                                </td>
                                <td data-label="Actions" style={{ padding: "12px", border: "none" }}>
                                  <div className="d-flex gap-1">
                                    {item.id !== undefined && dirtyItemIds.has(item.id) && (
                                      <button className="btn btn-sm btn-primary" title="Save this row" onClick={() => handleSaveItem(req.id, item.id!)}>
                                        <i className="bi bi-save"></i>
                                      </button>
                                    )}
                                    <button className="btn btn-sm btn-outline-secondary" title="Copy Item Name, Quantity, UoM and Machine Code" onClick={() => copyItems(`item-${item.id}`, [item])}>
                                      <i className={`bi ${copiedKey === `item-${item.id}` ? "bi-check2" : "bi-clipboard"}`}></i>
                                    </button>
                                    <button className="btn btn-sm btn-outline-secondary" title="Copy for the Item No./Item Description/Serial No./Required Date/Required Qty./UoM Code/Project grid" onClick={() => copyItemsForProjectGrid(`item-project-${item.id}`, [item], req.serial)}>
                                      <i className={`bi ${copiedKey === `item-project-${item.id}` ? "bi-check2" : "bi-clipboard-plus"}`}></i>
                                    </button>
                                    <button
                                      className="btn btn-sm btn-danger"
                                      disabled={(item.quantity_out || 0) > 0 || isHeldLocked}
                                      onClick={() => setDeleteTarget({ requestId: req.id, entityId: itemId, type: "item" })}
                                      title={isHeldLocked ? "On HOLD — only Secretary, Supervisor, or Manager can act on this item" : (item.quantity_out || 0) > 0 ? "Cannot delete — already released to the requester (Qty Out > 0)" : "Delete Item"}
                                    >
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className={`table table-sm ${styles.itemsTable}`} style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                        <thead style={{ backgroundColor: "#f8f9fa" }}>
                          <tr>
                            {["#", "Item Name", "Qty", "UoM", "Remarks", "Machine Code", "Balance", "Existence Status", "Status", "Details"].map((label) => (
                              <th key={label} style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, index) => (
                            <tr key={index} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa" }}>
                              <td style={{ padding: "12px", border: "none" }}>{index + 1}</td>
                              <td style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(item.item_name || "")}</td>
                              <td style={{ padding: "12px", border: "none" }}>{item.quantity}</td>
                              <td style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(item.uom || "")}</td>
                              <td style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(item.remarks || "N/A")}</td>
                              <td style={{ padding: "12px", border: "none" }}>{sanitizeUserInput(item.machine_code || "N/A")}</td>
                              <td style={{ padding: "12px", border: "none" }}>{getItemBalance(item)}</td>
                              <td style={{ padding: "12px", border: "none" }}>
                                <ItemExistenceBadge status={getItemExistenceStatus(item.item_name, itemCatalogNames)} />
                              </td>
                              <td style={{ padding: "12px", border: "none" }}>
                                <span className={`badge ${getItemStatusBadgeClass(item)}`}>{getItemStatusText(item)}</span>
                              </td>
                              <td style={{ padding: "12px", border: "none" }}>
                                {item.audits && item.audits.length > 0 ? <IssuanceHistory audits={item.audits} prNumber={(item.pr_type || item.delivery_status) === "URGENT" ? (item.date_needed ? new Date(item.date_needed).toLocaleDateString() : null) : item.pr_number} prNumberLabel={(item.pr_type || item.delivery_status) === "URGENT" ? "Date Needed" : "PR Number"} showPrNumber={isCustodian} /> : <span className="text-muted">-</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderServiceRow = (req: ServiceRequest) => {
    const key = makeRequestKey("service", req.id);
    const isExpanded = expandedRows.has(key);
    const detail = requestDetails.get(key);
    const isApproved = detail?.custodian_status === "approved" || isAdmin;
    const serviceRows: ServiceRow[] = editableServices.get(req.id) || detail?.services || [];

    return (
      <div key={req.id} className={styles.requestCard}>
        <div
          className={`${styles.requestCardRow} ${isExpanded ? styles.requestCardRowExpanded : ""}`}
          onClick={() => handleRowClick(req)}
        >
          <div className="text-center">
            <i className={`bi bi-chevron-${isExpanded ? "down" : "right"}`}></i>
          </div>
          <div className="fw-medium" data-label="Serial">{req.serial}</div>
          <div className="text-muted" data-label="Date">
            {req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : ""}
          </div>
          <div className="hide-sm" data-label="By">{req.created_by}</div>
          <div className="hide-sm" data-label="Dept">{req.department}</div>
          <div data-label="Purpose">{req.purpose}</div>
          <div>
            <span className="badge bg-success">SERVICE FINISHED</span>
          </div>
        </div>
        <div className={`${styles.expandWrapper} ${isExpanded ? styles.expandWrapperOpen : ""}`}>
          <div className={styles.expandInner}>
            {detail && (
              <div className={styles.requestCardBody}>
                <div className="p-3">
                  <h5 className="mb-3">Request Details</h5>

                  {isCustodian && (
                    <div className="d-flex flex-wrap gap-2 mb-3">
                      <button onClick={async () => { const { printRequestSlip } = await import("@features/requests/utils/print"); printRequestSlip(detail, "service"); }} className="btn btn-sm btn-primary" title="Print Service Request Slip">
                        <i className="bi bi-printer me-1"></i>Print SRS
                      </button>
                    </div>
                  )}

                  <div className="border rounded p-3 mb-3 bg-light">
                    <div className="fw-semibold text-secondary small text-uppercase mb-3">Request Information</div>
                    <div className="row g-3">
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Serial</div>
                        <div className="fw-semibold">{detail.serial}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Created Time</div>
                        <div className="fw-semibold">{formatMilitaryTime(detail.created_at)}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Department</div>
                        <div className="fw-semibold">{detail.department}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Requested By</div>
                        <div className="fw-semibold">{sanitizeUserInput(detail.requested_by || "—")}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
                        <span className={`badge ${getStatusBadgeClass(detail.status)}`}>{detail.status}</span>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
                        <div>{sanitizeUserInput(detail.remarks || "—")}</div>
                      </div>
                      <div className="col-12 col-sm-6 col-md">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
                        <div>{sanitizeUserInput(detail.purpose || "—")}</div>
                      </div>
                    </div>
                  </div>

                  <ApprovalStatusPanel
                    supervisorStatus={detail.supervisor_status}
                    supervisorApprovedByName={detail.supervisor_name || detail.supervisor_approved_by_name}
                    supervisorApprovedAt={detail.supervisor_approved_at}
                    custodianStatus={detail.custodian_status}
                    custodianApprovedByName={detail.custodian_name || detail.custodian_approved_by_name}
                    custodianApprovedAt={detail.custodian_approved_at}
                  />

                  <div className="border rounded p-3 mb-3">
                    <div className="fw-semibold text-secondary small text-uppercase mb-3">Purchase Request</div>
                    <div className="row g-3">
                      <div className="col-12 col-sm-6">
                        <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>PR Number</label>
                        {isCustodian ? (
                          <input type="text" className="form-control form-control-sm" placeholder="PR Number" value={detail.pr_number || ""} onChange={(e) => updateRequestDetail(req.id, "pr_number", e.target.value)} />
                        ) : (
                          <div>{detail.pr_number || "—"}</div>
                        )}
                      </div>
                      <div className="col-12 col-sm-6">
                        <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>PR Status</label>
                        {isCustodian ? (
                          <select className="form-select form-select-sm" value={detail.pr_status || "pending"} onChange={(e) => updateRequestDetail(req.id, "pr_status", e.target.value)}>
                            <option value="pending">Pending</option>
                            <option value="finish">Finish</option>
                          </select>
                        ) : (
                          <div>{detail.pr_status || "—"}</div>
                        )}
                      </div>
                      {detail.pr_number_updated_by_name && (
                        <>
                          <div className="col-12 col-sm-6">
                            <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>Custodian (Entered By)</label>
                            <div>{detail.pr_number_updated_by_name}</div>
                          </div>
                          <div className="col-12 col-sm-6">
                            <label className="text-muted d-block mb-1" style={{ fontSize: "0.75rem" }}>Date Entered</label>
                            <div>{detail.pr_number_updated_at ? new Date(detail.pr_number_updated_at).toISOString().split("T")[0] : "—"}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <hr className="my-3" />
                  <h5 className="mb-3">Services</h5>
                  <div className="table-responsive">
                    <table className="table table-sm" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                      <thead style={{ backgroundColor: "#f8f9fa" }}>
                        <tr>
                          {isCustodian && (
                            <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", width: "36px" }}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                title="Select all services"
                                disabled={!isApproved}
                                checked={serviceRows.length > 0 && getServiceSelection(req.id).size === serviceRows.length}
                                onChange={() => toggleSelectAllServices(req.id, serviceRows.length)}
                              />
                            </th>
                          )}
                          <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>#</th>
                          <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Description</th>
                          <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Status</th>
                          <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Receiving Report No.</th>
                          {isCustodian && (
                            <th style={{ padding: "12px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {serviceRows.map((service, index) => (
                          <tr key={index} style={{ backgroundColor: getServiceSelection(req.id).has(index) ? "#e7f1ff" : index % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                            {isCustodian && (
                              <td className={styles.serviceCell}>
                                <input type="checkbox" className="form-check-input" disabled={!isApproved} checked={getServiceSelection(req.id).has(index)} onChange={() => toggleServiceSelected(req.id, index)} />
                              </td>
                            )}
                            <td className={styles.serviceCell}>{index + 1}</td>
                            <td className={styles.serviceCell}>
                              {isAdmin ? (
                                <input type="text" className="form-control form-control-sm text-uppercase" value={service.description || ""} onChange={(e) => updateService(req.id, index, "description", e.target.value.toUpperCase())} />
                              ) : (service.description || "-")}
                            </td>
                            <td className={styles.serviceCell}>
                              {isCustodian ? (
                                <select className="form-select form-select-sm" value={service.delivery_status || "pending"} disabled={!isApproved} onChange={(e) => updateSelectedService(req.id, index, "delivery_status", e.target.value)}>
                                  <option value="pending">Pending</option>
                                  <option value="holded">{service.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                                  <option value="completed">Completed</option>
                                </select>
                              ) : (
                                <span className={`badge ${getServiceStatusBadgeClass(service)}`}>{getServiceStatusText(service)}</span>
                              )}
                            </td>
                            <td className={isCustodian ? styles.serviceCell : styles.serviceCellLast}>
                              {service.delivery_status === "completed" ? (
                                isCustodian ? (
                                  <>
                                    <input
                                      type="text"
                                      className="form-control form-control-sm"
                                      placeholder="Receiving Report No."
                                      disabled={!isApproved}
                                      value={service.receiving_report_no || ""}
                                      onChange={(e) => updateSelectedService(req.id, index, "receiving_report_no", e.target.value)}
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
                                            onClick={() => setDeleteTarget({ requestId: req.id, entityId: service.id!, type: "rr" })}
                                          >
                                            &times;
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </>
                                ) : (service.receiving_report_no || "-")
                              ) : "-"}
                            </td>
                            {isCustodian && (
                              <td className={styles.serviceCellLast}>
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => setDeleteTarget({ requestId: req.id, entityId: service.id ?? -1, type: "service" })}
                                  title="Delete Service"
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {isCustodian && hasServiceChanges.has(req.id) && (
                    <div className="mt-3 d-flex justify-content-end">
                      <button className="btn btn-primary btn-sm" onClick={() => handleSaveServiceUpdates(req.id)}>
                        <i className="bi bi-save me-1"></i>Save Service Updates
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
  };

  const renderSpecialRow = (
    type: "urgent" | "reimbursement",
    req: UrgentRequest | ReimbursementRequest,
    status: string,
    body: React.ReactNode
  ) => {
    const key = `${type}-${req.id}`;
    const isExpanded = expandedSpecial === key;
    return (
      <div key={key} className={styles.requestCard}>
        <div
          className={`${styles.requestCardRow} ${isExpanded ? styles.requestCardRowExpanded : ""}`}
          onClick={() => toggleSpecial(key)}
        >
          <div className="text-center">
            <i className={`bi bi-chevron-${isExpanded ? "down" : "right"}`}></i>
          </div>
          <div className="fw-medium" data-label="Serial">{req.serial}</div>
          <div className="text-muted" data-label="Date">
            {req.created_at ? new Date(req.created_at).toISOString().split("T")[0] : ""}
          </div>
          <div className="hide-sm" data-label="By">{req.requested_by || req.created_by}</div>
          <div className="hide-sm" data-label="Dept">{req.department}</div>
          <div data-label="Purpose">{req.purpose}</div>
          <div>
            <span className="badge bg-success">{status}</span>
          </div>
        </div>
        <div className={`${styles.expandWrapper} ${isExpanded ? styles.expandWrapperOpen : ""}`}>
          <div className={styles.expandInner}>
            {isExpanded && (
              <div className={styles.requestCardBody}>
                <div className="p-3">{body}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderUrgentRow = (req: UrgentRequest) =>
    renderSpecialRow("urgent", req, "DELIVERED", (
      <div className="table-responsive">
        <table className="table table-sm table-bordered mb-0">
          <thead>
            <tr>
              <th>#</th>
              <th>Item Description</th>
              <th>Qty</th>
              <th>UoM</th>
              <th>Inventoriable</th>
              <th>Qty Delivered</th>
              <th>Delivered By</th>
            </tr>
          </thead>
          <tbody>
            {req.items.map((item, index) => (
              <tr key={item.id ?? index}>
                <td>{index + 1}</td>
                <td>{item.item_description}</td>
                <td>{item.quantity ?? ""}</td>
                <td>{item.uom ?? ""}</td>
                <td>{item.is_inventoriable ? "Yes" : "No"}</td>
                <td>{item.is_inventoriable ? "—" : item.quantity_delivered ?? ""}</td>
                <td>{item.delivered_by_name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ));

  const renderReimbursementRow = (req: ReimbursementRequest) =>
    renderSpecialRow("reimbursement", req, "CLOSED", (
      <>
        <p className="mb-2"><strong>Supplier:</strong> {req.supplier}</p>
        <div className="table-responsive">
          <table className="table table-sm table-bordered mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Description</th>
                <th>Qty</th>
                <th>UoM</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {req.items.map((item, index) => (
                <tr key={item.id ?? index}>
                  <td>{index + 1}</td>
                  <td>{item.item_description}</td>
                  <td>{item.quantity ?? ""}</td>
                  <td>{item.uom ?? ""}</td>
                  <td className="text-end">{Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="text-end fw-semibold">Total</td>
                <td className="text-end fw-semibold">{req.total_cost}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ));

  const visibleCounts = {
    item: visibleItemRequests.length,
    service: visibleServiceRequests.length,
    urgent: visibleUrgentRequests.length,
    reimbursement: visibleReimbursementRequests.length,
  };
  const isEmpty = visibleCounts[activeTab] === 0;
  const emptyMessages = {
    item: "No completed item requests found.",
    service: "No finished service requests found.",
    urgent: "No delivered urgent requests found.",
    reimbursement: "No closed reimbursement requests found.",
  };
  const statusHeaders = { item: "IRS Status", service: "SRS Status", urgent: "Urgent Status", reimbursement: "Reimbursement Status" };

  return (
    <Layout>
      <div className="page-header">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h1 className="page-title">Complete Requests</h1>
            <p className="page-subtitle">Fully served item requests, finished service requests, delivered urgent requests and closed reimbursement requests</p>
          </div>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="dash-tabs">
          <button className={`dash-tab ${activeTab === "item" ? "active" : ""}`} onClick={() => setActiveTab("item")}>
            Item Requests
            <span className="dash-tab-badge">{visibleItemRequests.length}</span>
          </button>
          <button className={`dash-tab ${activeTab === "service" ? "active" : ""}`} onClick={() => setActiveTab("service")}>
            Service Requests
            <span className="dash-tab-badge">{visibleServiceRequests.length}</span>
          </button>
          <button className={`dash-tab ${activeTab === "urgent" ? "active" : ""}`} onClick={() => setActiveTab("urgent")}>
            Urgent Requests
            <span className="dash-tab-badge">{visibleUrgentRequests.length}</span>
          </button>
          <button className={`dash-tab ${activeTab === "reimbursement" ? "active" : ""}`} onClick={() => setActiveTab("reimbursement")}>
            Reimbursement Requests
            <span className="dash-tab-badge">{visibleReimbursementRequests.length}</span>
          </button>
        </div>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by Serial, Purpose, PR Number..."
        onExport={handleExport}
        exportDisabled={activeFilteredRows.length === 0}
      />

      <div className="mb-4 d-flex justify-content-between align-items-end flex-wrap gap-2">
        <DateRangeFilter />
        {isAdmin && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={confirmDeleteInRange}
            disabled={deletingInRange || !startDate || !endDate || activeFilteredRows.length === 0}
            title={!startDate || !endDate ? "Set Start Date and End Date first" : undefined}
          >
            <i className="bi bi-trash me-1"></i>
            {deletingInRange ? "Deleting..." : `Delete ${activeFilteredRows.length} in Date Range`}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-5" style={{ color: "#9ca3af" }}>
          <p className="mb-0">Loading...</p>
        </div>
      ) : isEmpty ? (
        <div className="text-center py-5" style={{ color: "#9ca3af" }}>
          <i className="bi bi-check2-circle" style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}></i>
          {emptyMessages[activeTab]}
        </div>
      ) : (
        <div className={styles.requestListFrame}>
          <div className={styles.requestListHeader}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Created By</div>
            <div>Department</div>
            <div>Purpose</div>
            <div>{statusHeaders[activeTab]}</div>
          </div>
          {activeTab === "item" && visibleItemRequests.map((req) => renderItemRow(req))}
          {activeTab === "service" && visibleServiceRequests.map((req) => renderServiceRow(req))}
          {activeTab === "urgent" && visibleUrgentRequests.map((req) => renderUrgentRow(req))}
          {activeTab === "reimbursement" && visibleReimbursementRequests.map((req) => renderReimbursementRow(req))}
        </div>
      )}

      <DeleteReasonModal
        isOpen={deleteTarget !== null}
        title={
          deleteTarget?.type === "service" ? "Delete Service" :
          deleteTarget?.type === "audit" ? "Delete Issuance Record" :
          deleteTarget?.type === "rr" ? "Clear Receiving Report No." :
          "Delete Item"
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget) {
            if (deleteTarget.type === "item") handleDeleteItem(deleteTarget.requestId, deleteTarget.entityId, reason);
            else if (deleteTarget.type === "service") handleDeleteService(deleteTarget.requestId, deleteTarget.entityId, reason);
            else if (deleteTarget.type === "rr") handleClearReceivingReport(deleteTarget.requestId, deleteTarget.entityId, reason);
            else handleDeleteAudit(deleteTarget.requestId, deleteTarget.entityId, reason);
          }
          setDeleteTarget(null);
        }}
      />

      <AdjustmentHistoryModal
        isOpen={historyRequestId !== null}
        onClose={() => setHistoryRequestId(null)}
        requestId={historyRequestId}
      />
    </Layout>
  );
};

export default CompleteRequestsPage;
