import React, { useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCustodianRequests } from "@/features/approvals/hooks/useCustodianRequests";
import { makeRequestKey } from "@/lib/utils/requestKey";
import { getBsStatusBadgeClass, getCompositeStatus } from "@/lib/utils/status";
import { sanitizeUserInput } from "@/lib/utils/sanitize";
import DeleteReasonModal from "@/components/dialogs/DeleteReasonModal";
import AdjustmentHistoryModal from "@/features/reports/components/AdjustmentHistoryModal";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import type { ServiceRow } from "@/types";

/**
 * Held Services. Items no longer have an On Hold status (it was replaced by
 * CANCEL, with a required reason, on the Pending Requests page), so this page
 * now lists service requests only — a service's "holded"
 * delivery_status is just a third option alongside "pending"/"completed"
 * (see the Status <select> in CustodianDashboard/CompleteRequestsPage), with
 * none of the above hand-off machinery: no hold_edited tracking, no
 * approval-preservation logic, no Secretary/Supervisor/Manager edit access.
 * This page only filters to requests with a Holded service and lets
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
  const {
    filteredServiceRequests,
    requestDetails,
    expandedRows,
    editableServices,
    hasServiceChanges,
    handleRowClick,
    handleDeleteItem,
    updateService,
    handleSaveServiceUpdates,
    handleDeleteService,
  } = useCustodianRequests({ initialTab: "service" });

  // Which item (or service) is queued for deletion, pending a typed reason —
  // see DeleteReasonModal below.
  const [deleteTarget, setDeleteTarget] = useState<{ requestId: number; entityId: number; type: "item" | "service" } | null>(null);

  // Which request's Adjustment History modal is open, if any — item or
  // service (a Secretary/Supervisor/Manager fixing a Holded service's
  // Description logs one too, see status.controller.ts's
  // updateRequestServiceItem). The type has to travel with the id since
  // item_requests.id and service_requests.id are independent sequences.
  const [historyRequest, setHistoryRequest] = useState<{ id: number; type: "item" | "service" } | null>(null);

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
  const filteredHeldServiceRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return heldServiceRequests;
    return heldServiceRequests.filter((row) => matchesSearch(row, q));
  }, [heldServiceRequests, searchQuery]);

  const handleExport = () =>
    exportToExcel(
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
        <h1 className="page-title">Held Services</h1>
        <p className="page-subtitle mb-1 d-flex flex-wrap gap-2">
          <span className="badge bg-danger">How many services on Hold: {heldServiceCount}</span>
        </p>
        <p className="page-subtitle">
          Services currently marked ON HOLD.
        </p>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by Serial, Department, Purpose, Requested By, or Status..."
        onExport={handleExport}
        exportDisabled={filteredHeldServiceRequests.length === 0}
      />

      <div className="mb-4">
        <DateRangeFilter />
      </div>

      {(
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
