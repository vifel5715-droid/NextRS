import React, { useMemo, useState } from "react";
import { useAuth } from "@app/providers/AuthProvider";
import { useCustodianRequests } from "@features/requests/hooks/useCustodianRequests";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import { makeRequestKey } from "@shared/utils/requestKey";
import { getBsStatusBadgeClass, getCompositeStatus } from "@shared/utils/status";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import AdjustmentHistoryModal from "@features/adjustments/components/AdjustmentHistoryModal";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { ItemExistenceBadge } from "@shared/components/ItemExistenceStatus";
import { useItemCatalogEntries } from "@features/item-catalog/hooks/useItemCatalogEntries";
import { getItemExistenceStatus } from "@shared/utils/itemExistenceStatus";
import { exportToExcel } from "@shared/utils/exportExcel";
import { UOM_OPTIONS } from "@constants/uom";
import { isMachineCodeEnabled } from "@shared/utils/machineCodeValidation";
import type { ItemRow, ServiceRow } from "@shared/types";

/**
 * ARCH: A HOLD item is a hand-off — the custodian puts an item on HOLD and
 * immediately loses edit access to that row (see CustodianDashboard's
 * isHeldLocked, and canEdit below — custodian is strictly read-only on this
 * page, full stop); Secretary/Supervisor/Manager, who otherwise have no
 * route into the custodian's item tables at all, gain edit access to
 * exactly that row here so they can fix the item's name/quantity/UoM/
 * remarks/machine code while it's held. Status itself is deliberately NOT
 * pickable here for that role set — only admin can choose one explicitly.
 * Saving does NOT resolve the HOLD by itself (server-side, see
 * status.controller.ts's updateRequestItem): the item stays on HOLD and the
 * row stays on this page, but it flips hold_edited to true so the label
 * reads "RELEASE ON HOLD" instead of "ON HOLD" — the custodian still has to
 * actually release it from Pending Requests. The custodian's approval
 * on the request is untouched by any of this — placing an item on HOLD,
 * fixing its details while held, and the custodian later resolving the HOLD
 * all leave custodian_status exactly as it was; nothing in the HOLD
 * lifecycle ever resets it. This page exists solely
 * for the HOLD hand-off: a request block only appears here at all while at
 * least one of its items is actually on HOLD — once every item on a request
 * has moved off HOLD, that request drops off this page entirely, custodian
 * included.
 *
 * The Service Requests tab is a much simpler sibling — a service's "holded"
 * delivery_status is just a third option alongside "pending"/"completed"
 * (see the Status <select> in CustodianDashboard/CompleteRequestsPage), with
 * none of the above hand-off machinery: no hold_edited tracking, no
 * approval-preservation logic, no Secretary/Supervisor/Manager edit access.
 * This tab only filters to requests with a Holded service and lets
 * custodian/admin change status/delete a line, same as everywhere else in
 * the app already lets them.
 */
const HeldItemsPage: React.FC = () => {
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isAdmin = role === "admin";
  const isCustodian = role === "custodian";
  const isStaff = role === "staff";
  // Staff may correct their own held rows too — their list only contains
  // their own requests, and the server re-checks ownership. Deleting a held
  // row stays with Secretary/Supervisor/Manager/custodian.
  const canResolveHold = role === "secretary" || role === "supervisor" || role === "manager" || isStaff;
  const itemCatalogEntries = useItemCatalogEntries();
  const itemCatalogNames = useMemo(
    () => Array.from(new Set(itemCatalogEntries.map((entry) => entry.item_name))).sort(),
    [itemCatalogEntries]
  );
  // Uppercase name -> its catalog UoM, so an exact-match item name can lock
  // the UoM field to the real value instead of leaving it on whatever was
  // typed before — see canEdit's isUomLocked below.
  const itemCatalogUomByName = useMemo(
    () => new Map(itemCatalogEntries.map((entry) => [entry.item_name.toUpperCase(), entry.uom])),
    [itemCatalogEntries]
  );
  const machineCodeOptions = useMachineCodeOptions();

  const {
    activeTab,
    setActiveTab,
    filteredItemRequests,
    filteredServiceRequests,
    requestDetails,
    expandedRows,
    dirtyItemIds,
    editableServices,
    hasServiceChanges,
    handleRowClick,
    updateItemField,
    handleSaveItem,
    handleDeleteItem,
    updateService,
    handleSaveServiceUpdates,
    handleDeleteService,
  } = useCustodianRequests();

  // Which item (or service) is queued for deletion, pending a typed reason —
  // see DeleteReasonModal below.
  const [deleteTarget, setDeleteTarget] = useState<{ requestId: number; entityId: number; type: "item" | "service" } | null>(null);

  // Which request's Adjustment History modal is open, if any — item or
  // service (a Secretary/Supervisor/Manager fixing a Holded service's
  // Description logs one too, see status.controller.ts's
  // updateRequestServiceItem). The type has to travel with the id since
  // item_requests.id and service_requests.id are independent sequences.
  const [historyRequest, setHistoryRequest] = useState<{ id: number; type: "item" | "service" } | null>(null);

  const heldRequests = useMemo(
    () => filterByDateRange(filteredItemRequests.filter((row) => row.has_held_item), startDate, endDate, "created_at"),
    [filteredItemRequests, startDate, endDate]
  );

  // Total items on HOLD across every held request currently in view — server-
  // computed per request (see item-request.controller.ts's held_item_count),
  // summed here rather than counted from `details.items` since those are
  // lazy-loaded per row on expand and often aren't fetched yet.
  const heldItemCount = useMemo(
    () => heldRequests.reduce((sum, row) => sum + (row.held_item_count || 0), 0),
    [heldRequests]
  );

  // Services (unlike items) come back with their full `services` array
  // already attached on the list endpoint itself — see
  // service-request.controller.ts's getServiceRequests — so no lazy per-row
  // fetch is needed to know which requests have a Holded service.
  const heldServiceRequests = useMemo(
    () =>
      filterByDateRange(
        filteredServiceRequests.filter((row) => (row.services || []).some((s) => s.delivery_status === "holded")),
        startDate,
        endDate,
        "created_at"
      ),
    [filteredServiceRequests, startDate, endDate]
  );

  const heldServiceCount = useMemo(
    () => heldServiceRequests.reduce((sum, row) => sum + (row.services || []).filter((s) => s.delivery_status === "holded").length, 0),
    [heldServiceRequests]
  );

  // Local, page-specific search — the hook's own searchQuery only matches
  // serial/purpose/remarks/pr_numbers, not department or requested_by, which
  // this toolbar's placeholder promises. Items themselves aren't searched:
  // they're lazy-loaded per row on expand (requestDetails), so a reliable
  // item-level search/export would first need every row's details fetched.
  const [searchQuery, setSearchQuery] = useState("");
  const matchesSearch = (row: { serial?: string; department?: string; purpose?: string; requested_by?: string; created_by?: string }, q: string) => {
    const composite = getCompositeStatus(row as unknown as Record<string, unknown>);
    return (
      (row.serial || "").toLowerCase().includes(q) ||
      (row.department || "").toLowerCase().includes(q) ||
      (row.purpose || "").toLowerCase().includes(q) ||
      (row.requested_by || row.created_by || "").toLowerCase().includes(q) ||
      composite.text.toLowerCase().includes(q)
    );
  };
  const filteredHeldRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return heldRequests;
    return heldRequests.filter((row) => matchesSearch(row, q));
  }, [heldRequests, searchQuery]);
  const filteredHeldServiceRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return heldServiceRequests;
    return heldServiceRequests.filter((row) => matchesSearch(row, q));
  }, [heldServiceRequests, searchQuery]);

  const handleExport = () =>
    activeTab === "item"
      ? exportToExcel(
          "held-items",
          [
            { key: "serial", label: "Serial" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "requested_by", label: "Requested By" },
            { key: "status", label: "Status" },
          ],
          filteredHeldRequests.map((row) => ({
            serial: row.serial || "",
            department: row.department || "",
            purpose: row.purpose || "",
            requested_by: row.requested_by || row.created_by || "",
            status: getCompositeStatus(row as unknown as Record<string, unknown>).text,
          }))
        )
      : exportToExcel(
          "held-services",
          [
            { key: "serial", label: "Serial" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "requested_by", label: "Requested By" },
            { key: "status", label: "Status" },
          ],
          filteredHeldServiceRequests.map((row) => ({
            serial: row.serial || "",
            department: row.department || "",
            purpose: row.purpose || "",
            requested_by: row.requested_by || row.created_by || "",
            status: getCompositeStatus(row as unknown as Record<string, unknown>).text,
          }))
        );

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Held Items</h1>
        <p className="page-subtitle mb-1 d-flex flex-wrap gap-2">
          <span className="badge bg-danger">How many items on Hold: {heldItemCount}</span>
          <span className="badge bg-danger">How many services on Hold: {heldServiceCount}</span>
        </p>
        <p className="page-subtitle">
          {activeTab === "item"
            ? isStaff
              ? "Your request items on HOLD — fix the item name, quantity, UoM, remarks, or machine code, then save. The item stays on HOLD until the custodian reviews and releases it."
              : canResolveHold
              ? "Items on HOLD in your department — fix the item name, quantity, UoM, remarks, or machine code, then save. The item stays on HOLD until the custodian reviews and releases it."
              : isCustodian
              ? "Read-only — items on HOLD can only be edited by Secretary, Supervisor, or Manager."
              : "Items currently on HOLD."
            : "Services currently marked ON HOLD."}
        </p>
      </div>

      <div className="dash-toolbar mb-3">
        <div className="dash-tabs">
          <button
            className={`dash-tab ${activeTab === "item" ? "active" : ""}`}
            onClick={() => setActiveTab("item")}
          >
            Item Requests
            <span className="dash-tab-badge">{heldRequests.length}</span>
          </button>
          <button
            className={`dash-tab ${activeTab === "service" ? "active" : ""}`}
            onClick={() => setActiveTab("service")}
          >
            Service Requests
            <span className="dash-tab-badge">{heldServiceRequests.length}</span>
          </button>
        </div>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by Serial, Department, Purpose, Requested By, or Status..."
        onExport={handleExport}
        exportDisabled={(activeTab === "item" ? filteredHeldRequests : filteredHeldServiceRequests).length === 0}
      />

      <div className="mb-4">
        <DateRangeFilter />
      </div>

      {activeTab === "item" && (
      <div className="dash-table-wrapper">
        {heldRequests.length === 0 ? (
          <div className="text-muted text-center py-4">No items on HOLD.</div>
        ) : filteredHeldRequests.length === 0 ? (
          <div className="text-muted text-center py-4">No held requests match your search.</div>
        ) : (
          filteredHeldRequests.map((row) => {
            const key = makeRequestKey("item", row.id);
            const isExpanded = expandedRows.has(key);
            const details = requestDetails.get(key);
            const composite = getCompositeStatus(row as unknown as Record<string, unknown>);
            // Item Name suggestions are scoped to THIS request's department —
            // a catalog entry whose `departments` list doesn't include it is
            // hidden from the dropdown; unrestricted (null/empty) entries stay
            // visible everywhere. Same rule StaffDashboard's create-request
            // form applies, just keyed off the request's department here
            // instead of the viewer's, since Secretary/Supervisor/Manager
            // resolve HOLD items across every department, not just their own.
            const departmentItemCatalogNames = Array.from(
              new Set(
                itemCatalogEntries
                  .filter((entry) => {
                    if (!entry.departments) return true;
                    const allowed = entry.departments.split(",").map((d) => d.trim().toUpperCase());
                    return allowed.includes((row.department || "").toUpperCase());
                  })
                  .map((entry) => entry.item_name)
              )
            ).sort();
            // Machine Code only applies to Engineering (ENGG) requests — every
            // other department shows N/A, read-only, same rule as the
            // create/edit request forms (and enforced server-side).
            const machineCodeEnabled = isMachineCodeEnabled(row.department);
            return (
              <div key={row.id} className="border rounded mb-2">
                <div
                  className="d-flex justify-content-between align-items-center p-3"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleRowClick(row)}
                >
                  <div style={{ flex: 1 }}>
                    <span className="text-muted">Serial:</span> <span className="fw-semibold" style={{ marginRight: "0.75rem" }}>{row.serial}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Department:</span> <span style={{ marginRight: "0.75rem" }}>{row.department}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Purpose:</span> <span style={{ marginRight: "0.75rem" }}>{sanitizeUserInput(row.purpose)}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Requested By:</span> <span>{sanitizeUserInput(row.requested_by || row.created_by || "—")}</span>
                  </div>
                  <button
                    className="btn btn-sm btn-primary me-2"
                    onClick={(e) => { e.stopPropagation(); setHistoryRequest({ id: row.id, type: "item" }); }}
                  >
                    <i className="bi bi-clock-history me-1"></i>Adjustment History
                  </button>
                  <span className={`badge ${getBsStatusBadgeClass(composite.class)}`}>{composite.text}</span>
                </div>

                {isExpanded && details?.items && (
                  <div className="table-responsive p-3 pt-0">
                    <table className="table table-sm mb-0" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                      <thead style={{ backgroundColor: "#f8f9fa" }}>
                        <tr>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>#</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Item Name</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Qty</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>UoM</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Remarks</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Machine Code</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Existence Status</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Status</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.items.map((item: ItemRow, index: number) => {
                          const isHeld = item.delivery_status === "HOLD";
                          // A row already mid-edit stays editable regardless of what the
                          // live-picked status currently resolves to — otherwise the
                          // instant a secretary picks anything other than HOLD, canEdit
                          // would flip false and the Select/Save button would vanish
                          // before the change ever reaches the server (same class of bug
                          // as CustodianDashboard's canEditItemName; see its isRowDirty).
                          const isRowDirty = item.id !== undefined && dirtyItemIds.has(item.id);
                          // Custodian is strictly read-only on this page — HOLD is set from
                          // Pending Requests, not here, so custodian never needs to edit a
                          // row on the Held Items page itself. Only Secretary/Supervisor/
                          // Manager (or admin) can resolve a held row here.
                          const canEdit = isAdmin || isRowDirty || (canResolveHold && isHeld);
                          const existenceStatus = getItemExistenceStatus(item.item_name, itemCatalogNames);
                          // Once the name is an exact catalog match, the UoM is fixed to
                          // that entry's real value — locked, not just pre-filled, so it
                          // can't drift from the catalog again. See StaffDashboard's
                          // create-item-request form for the same rule.
                          const isUomLocked = existenceStatus === "existing";
                          return (
                            <tr key={item.id ?? `new-${index}`} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa" }}>
                              <td style={{ padding: "10px", border: "none" }}>{index + 1}</td>
                              <td style={{ padding: "10px", border: "none" }}>
                                {canEdit ? (
                                  <SearchableCombobox
                                    className="form-control form-control-sm text-uppercase"
                                    value={item.item_name || ""}
                                    onChange={(value) => {
                                      updateItemField(row.id, index, "item_name", value.toUpperCase());
                                      // Exact catalog match: fix the UoM to the real value
                                      // rather than leave it on whatever was picked before.
                                      const matchedUom = itemCatalogUomByName.get(value.trim().toUpperCase());
                                      if (matchedUom) updateItemField(row.id, index, "uom", matchedUom);
                                    }}
                                    options={departmentItemCatalogNames}
                                    placeholder="Search or type item name…"
                                    onEnter={item.id !== undefined ? () => handleSaveItem(row.id, item.id!) : undefined}
                                  />
                                ) : sanitizeUserInput(item.item_name)}
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                {canEdit ? (
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
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                {canEdit ? (
                                  <select
                                    className="form-select form-select-sm text-uppercase"
                                    style={{ width: "110px" }}
                                    aria-label={`UoM for ${item.item_name || `item ${index + 1}`}`}
                                    value={(UOM_OPTIONS as readonly string[]).includes(item.uom) ? item.uom : ""}
                                    onChange={(e) => updateItemField(row.id, index, "uom", e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(row.id, item.id); } }}
                                    disabled={isUomLocked}
                                  >
                                    <option value="" disabled>Select UoM</option>
                                    {UOM_OPTIONS.map((uom) => (
                                      <option key={uom} value={uom}>{uom}</option>
                                    ))}
                                  </select>
                                ) : item.uom}
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                {canEdit ? (
                                  <input
                                    type="text"
                                    className="form-control form-control-sm text-uppercase"
                                    value={item.remarks || ""}
                                    onChange={(e) => updateItemField(row.id, index, "remarks", e.target.value.toUpperCase())}
                                    onKeyDown={(e) => { if (e.key === "Enter" && item.id !== undefined) { e.preventDefault(); handleSaveItem(row.id, item.id); } }}
                                  />
                                ) : sanitizeUserInput(item.remarks || "N/A")}
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                {canEdit && machineCodeEnabled ? (
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
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                <ItemExistenceBadge status={existenceStatus} />
                              </td>
                              {/* Status stays read-only for Secretary/Supervisor/Manager even
                                  while the rest of the row is editable — they don't pick a
                                  status themselves, saving their correction auto-clears the
                                  HOLD server-side instead (see status.controller.ts's
                                  updateRequestItem). Only admin can pick one explicitly here. */}
                              <td style={{ padding: "10px", border: "none" }}>
                                {isAdmin ? (
                                  <select
                                    className="form-select form-select-sm"
                                    style={{ width: "160px" }}
                                    value={item.delivery_status || ""}
                                    onChange={(e) => updateItemField(row.id, index, "delivery_status", e.target.value)}
                                  >
                                    <option value="">Select Status</option>
                                    <option value="OUT">OUT</option>
                                    <option value="PURCHASE REQUEST">PURCHASE REQUEST</option>
                                    <option value="URGENT">URGENT</option>
                                    <option value="HOLD">{item.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                                  </select>
                                ) : (
                                  <span className={isHeld ? "badge bg-warning text-dark" : "text-muted"}>
                                    {isHeld ? (item.hold_edited ? "RELEASE ON HOLD" : "ON HOLD") : (item.delivery_status || "—")}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "10px", border: "none" }}>
                                <div className="d-flex gap-1">
                                  {canEdit && item.id !== undefined && dirtyItemIds.has(item.id) && (
                                    <button
                                      className="btn btn-sm btn-primary"
                                      title="Save this row"
                                      onClick={() => handleSaveItem(row.id, item.id!)}
                                    >
                                      <i className="bi bi-save"></i> Save
                                    </button>
                                  )}
                                  {canEdit && !isStaff && item.id !== undefined && (
                                    <button
                                      className="btn btn-sm btn-danger"
                                      disabled={(item.quantity_out || 0) > 0}
                                      title={(item.quantity_out || 0) > 0 ? "Cannot delete — already released to the requester (Qty Out > 0)" : "Delete Item"}
                                      onClick={() => setDeleteTarget({ requestId: row.id, entityId: item.id!, type: "item" })}
                                    >
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      )}

      {activeTab === "service" && (
      <div className="dash-table-wrapper">
        {heldServiceRequests.length === 0 ? (
          <div className="text-muted text-center py-4">No services on HOLD.</div>
        ) : filteredHeldServiceRequests.length === 0 ? (
          <div className="text-muted text-center py-4">No held requests match your search.</div>
        ) : (
          filteredHeldServiceRequests.map((row) => {
            const key = makeRequestKey("service", row.id);
            const isExpanded = expandedRows.has(key);
            const details = requestDetails.get(key);
            const composite = getCompositeStatus(row as unknown as Record<string, unknown>);
            const serviceRows: ServiceRow[] = editableServices.get(row.id) || details?.services || [];
            return (
              <div key={row.id} className="border rounded mb-2">
                <div
                  className="d-flex justify-content-between align-items-center p-3"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleRowClick(row)}
                >
                  <div style={{ flex: 1 }}>
                    <span className="text-muted">Serial:</span> <span className="fw-semibold" style={{ marginRight: "0.75rem" }}>{row.serial}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Department:</span> <span style={{ marginRight: "0.75rem" }}>{row.department}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Purpose:</span> <span style={{ marginRight: "0.75rem" }}>{sanitizeUserInput(row.purpose)}</span>
                    <span className="text-muted" style={{ marginRight: "0.75rem" }}>|</span>
                    <span className="text-muted">Requested By:</span> <span>{sanitizeUserInput(row.requested_by || row.created_by || "—")}</span>
                  </div>
                  <button
                    className="btn btn-sm btn-primary me-2"
                    onClick={(e) => { e.stopPropagation(); setHistoryRequest({ id: row.id, type: "service" }); }}
                  >
                    <i className="bi bi-clock-history me-1"></i>Adjustment History
                  </button>
                  <span className={`badge ${getBsStatusBadgeClass(composite.class)}`}>{composite.text}</span>
                </div>

                {isExpanded && details?.services && (
                  <div className="table-responsive p-3 pt-0">
                    <table className="table table-sm mb-0" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                      <thead style={{ backgroundColor: "#f8f9fa" }}>
                        <tr>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>#</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Description</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Status</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}>Receiving Report No.</th>
                          <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceRows.map((service, index) => (
                          <tr key={index} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa" }}>
                            <td style={{ padding: "10px", border: "none" }}>{index + 1}</td>
                            <td style={{ padding: "10px", border: "none" }}>
                              {/* Mirrors the item side's hand-off split: Secretary/
                                  Supervisor/Manager fix the content of the specific
                                  Holded line (not every line on the request — same
                                  per-row scoping as the item table's isHeld check),
                                  custodian handles Status/deletion below. Not the
                                  full item-style workflow (no hold_edited tracking
                                  for services), just the same editable-by-role idea. */}
                              {isAdmin || (canResolveHold && service.delivery_status === "holded") ? (
                                <input
                                  type="text"
                                  className="form-control form-control-sm text-uppercase"
                                  value={service.description || ""}
                                  onChange={(e) => updateService(row.id, index, "description", e.target.value.toUpperCase())}
                                />
                              ) : sanitizeUserInput(service.description || "N/A")}
                            </td>
                            <td style={{ padding: "10px", border: "none" }}>
                              {isCustodian || isAdmin ? (
                                <select
                                  className="form-select form-select-sm"
                                  style={{ width: "160px" }}
                                  value={service.delivery_status || "pending"}
                                  onChange={(e) => updateService(row.id, index, "delivery_status", e.target.value)}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="holded">{service.hold_edited ? "RELEASE ON HOLD" : "ON HOLD"}</option>
                                  <option value="completed">Completed</option>
                                </select>
                              ) : (
                                <span className={service.delivery_status === "holded" ? "badge bg-danger" : "text-muted"}>
                                  {service.delivery_status === "holded" ? (service.hold_edited ? "RELEASE ON HOLD" : "ON HOLD") : (service.delivery_status || "Pending")}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "10px", border: "none" }}>{service.receiving_report_no || "-"}</td>
                            <td style={{ padding: "10px", border: "none" }}>
                              {/* Same per-row Holded scoping as the Description edit above —
                                  Secretary/Supervisor/Manager may only delete the specific
                                  Holded line, custodian/admin can delete any line here. */}
                              {(isAdmin || isCustodian || (canResolveHold && !isStaff && service.delivery_status === "holded")) && service.id !== undefined && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  title="Delete Service"
                                  onClick={() => setDeleteTarget({ requestId: row.id, entityId: service.id!, type: "service" })}
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(isCustodian || canResolveHold || isAdmin) && hasServiceChanges.has(row.id) && (
                      <div className="d-flex justify-content-end mt-2">
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveServiceUpdates(row.id)}>
                          <i className="bi bi-save me-1"></i>Save Service Updates
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      )}

      <DeleteReasonModal
        isOpen={deleteTarget !== null}
        title={deleteTarget?.type === "service" ? "Delete Service" : "Delete Item"}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget?.type === "service") handleDeleteService(deleteTarget.requestId, deleteTarget.entityId, reason);
          else if (deleteTarget) handleDeleteItem(deleteTarget.requestId, deleteTarget.entityId, reason);
          setDeleteTarget(null);
        }}
      />

      <AdjustmentHistoryModal
        isOpen={historyRequest !== null}
        onClose={() => setHistoryRequest(null)}
        requestId={historyRequest?.id ?? null}
        requestType={historyRequest?.type}
      />
    </>
  );
};

export default HeldItemsPage;
