import React, { useMemo, useState } from "react";
import { useUrgentRequests } from "@features/requests/hooks/useUrgentRequests";
import { useItemCatalogNames } from "@features/item-catalog/hooks/useItemCatalogNames";
import Layout from "@shared/components/Layout";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { exportToExcel } from "@shared/utils/exportExcel";
import { formatDate } from "@shared/utils/format";
import { urgentRequestAPI } from "../../../services/api";
import { getErrorMessage } from "@shared/utils/errorMessage";

const statusBadge = (status: string) => {
  switch (status) {
    case "approved": return { label: "APPROVED", bg: "#d1fae5", color: "#065f46" };
    case "rejected": return { label: "REJECTED", bg: "#fee2e2", color: "#991b1b" };
    case "not_required": return { label: "NOT REQUIRED", bg: "#e5e7eb", color: "#4b5563" };
    default: return { label: "PENDING", bg: "#fef3c7", color: "#92400e" };
  }
};

/**
 * "New Item List" — Urgent Request items (see the Urgent Request workflow:
 * urgent_requests/urgent_request_items, its own Supervisor/Stockroom
 * approval chain) narrowed to ones marked Inventoriable: real trackable
 * stock, as opposed to a Not Inventoriable one-off the requesting department
 * self-attests delivery on. Not to be confused with UrgentItemsPage.tsx's
 * "Urgent Item From IRS", which covers the separate Item Request System
 * pr_type URGENT items.
 *
 * The custodian's job here is registering each item against its Item
 * Catalog counterpart — same "Counterpart Name" registration pattern as
 * PendingItemEntryPage.tsx, gated on this page's own new_item_list
 * permission (see urgent-request.routes.ts's catalog-item route).
 */
const NewItemListPage: React.FC = () => {
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState<"all" | "pending" | "registered">("all");

  const { urgentRequests, loadingUrgentRequests } = useUrgentRequests();
  const catalogNames = useItemCatalogNames();

  // Inline per-item registration editor — one row editable at a time, same
  // pattern as PendingItemEntryPage.tsx.
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [draftCatalogName, setDraftCatalogName] = useState("");
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      urgentRequests.flatMap((req) =>
        req.items
          .filter((item) => item.is_inventoriable && item.id != null)
          .map((item) => ({
            key: `${req.id}-${item.id}`,
            request_id: req.id,
            id: item.id as number,
            serial: req.serial,
            department: req.department,
            purpose: req.purpose,
            status: req.stockroom_status,
            item_description: item.item_description,
            quantity: item.quantity,
            uom: item.uom || "",
            catalog_item_name: item.catalog_item_name || "",
            created_at: req.created_at,
          })),
      ),
    [urgentRequests]
  );

  const startEditing = (row: { id: number; catalog_item_name: string }) => {
    setEditingItemId(row.id);
    setDraftCatalogName(row.catalog_item_name);
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setDraftCatalogName("");
  };

  const saveEditing = async (requestId: number) => {
    if (!editingItemId) return;
    setSavingItemId(editingItemId);
    try {
      await urgentRequestAPI.setItemCatalogLink(requestId, editingItemId, { catalog_item_name: draftCatalogName });
      cancelEditing();
    } catch (error: unknown) {
      alert("Error saving registered item: " + getErrorMessage(error));
    } finally {
      setSavingItemId(null);
    }
  };

  const rowsInRange = useMemo(
    () => filterByDateRange(rows, startDate, endDate, "created_at"),
    [rows, startDate, endDate]
  );

  const pendingCount = useMemo(() => rowsInRange.filter((row) => !row.catalog_item_name).length, [rowsInRange]);
  const registeredCount = useMemo(() => rowsInRange.filter((row) => row.catalog_item_name).length, [rowsInRange]);

  const filteredRows = useMemo(() => {
    let filtered = rowsInRange;
    if (entryFilter === "pending") filtered = filtered.filter((row) => !row.catalog_item_name);
    if (entryFilter === "registered") filtered = filtered.filter((row) => !!row.catalog_item_name);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((row) =>
      row.item_description.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.department.toLowerCase().includes(q) ||
      row.catalog_item_name.toLowerCase().includes(q)
    );
  }, [rowsInRange, entryFilter, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      "new-item-list",
      [
        { key: "serial", label: "Serial Number" },
        { key: "created_at", label: "Created Date" },
        { key: "department", label: "Department" },
        { key: "purpose", label: "Purpose" },
        { key: "item_description", label: "Item from Urgent Requests" },
        { key: "quantity", label: "Qty" },
        { key: "uom", label: "UoM" },
        { key: "catalog_item_name", label: "Counterpart Name" },
        { key: "status_label", label: "Status" },
      ],
      filteredRows.map((row) => ({
        ...row,
        created_at: formatDate(row.created_at),
        catalog_item_name: row.catalog_item_name || "Not Registered",
        status_label: statusBadge(row.status).label,
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">New Item List</h1>
            <p className="dash-subtitle" style={{ color: "#065f46" }}>
              Urgent Request items marked Inventoriable — register each one against its Item Catalog counterpart
            </p>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {([
            { key: "all" as const, label: "All New Items", count: rowsInRange.length },
            { key: "pending" as const, label: "Not yet registered", count: pendingCount },
            { key: "registered" as const, label: "Registered", count: registeredCount },
          ]).map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => setEntryFilter(tile.key)}
              style={{
                flex: "1 1 200px",
                minWidth: "160px",
                textAlign: "left",
                background: "#d1fae5",
                border: `2px solid ${entryFilter === tile.key ? "#065f46" : "#a7f3d0"}`,
                borderRadius: "10px",
                padding: "10px 14px",
                cursor: "pointer",
                boxShadow: entryFilter === tile.key ? "0 2px 6px rgba(0,0,0,0.12)" : "none",
              }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#065f46", lineHeight: 1.2 }}>{tile.count}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#065f46", opacity: 0.85 }}>{tile.label}</div>
            </button>
          ))}
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item, Serial, Purpose, Department, or Counterpart Name..."
          onExport={handleExport}
          exportDisabled={filteredRows.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #a7f3d0", borderRadius: "10px", overflow: "hidden" }}>
          {loadingUrgentRequests ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>Loading...</div>
          ) : rowsInRange.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-box-seam" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No new items found.</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No items match your search and filters.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#d1fae5", borderBottom: "2px solid #a7f3d0" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Serial Number</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Created Date</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Department</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Purpose</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Item from Urgent Requests</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>UoM</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Counterpart Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => {
                    const isEditing = editingItemId === row.id;
                    const badge = statusBadge(row.status);
                    return (
                      <tr
                        key={row.key}
                        style={{ borderBottom: "1px solid #a7f3d0", background: i % 2 === 0 ? "#ecfdf5" : "#fff" }}
                      >
                        <td data-label="Serial Number" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                        <td data-label="Created Date" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                        <td data-label="Department" style={{ padding: "11px 16px" }}>{row.department}</td>
                        <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                        <td data-label="Item from Urgent Requests" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_description}</td>
                        <td data-label="Qty" style={{ padding: "11px 16px", fontWeight: 600 }}>{row.quantity ?? ""}</td>
                        <td data-label="UoM" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.uom}</td>
                        <td data-label="Counterpart Name" style={{ padding: "11px 16px" }}>
                          {isEditing ? (
                            <div className="d-flex flex-wrap gap-2 align-items-center">
                              <div style={{ width: "200px" }}>
                                <SearchableCombobox
                                  className="form-control form-control-sm"
                                  value={draftCatalogName}
                                  onChange={setDraftCatalogName}
                                  options={catalogNames}
                                  placeholder="Search or type item name…"
                                  noResultsText="No record found"
                                  onEnter={() => saveEditing(row.request_id)}
                                />
                              </div>
                              <button
                                className="btn btn-sm btn-success"
                                disabled={savingItemId === row.id}
                                onClick={() => saveEditing(row.request_id)}
                              >
                                Save
                              </button>
                              <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditing}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="d-flex align-items-center gap-2">
                              {row.catalog_item_name ? (
                                <span
                                  className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 fw-semibold"
                                  style={{ backgroundColor: "#dcfce7", color: "#15803d", fontSize: "0.78rem" }}
                                >
                                  <i className="bi bi-check2-circle"></i>
                                  {row.catalog_item_name}
                                </span>
                              ) : (
                                <span
                                  className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 text-muted"
                                  style={{ backgroundColor: "#f1f5f9", fontSize: "0.78rem" }}
                                >
                                  <i className="bi bi-hourglass-split"></i>
                                  Not Registered
                                </span>
                              )}
                              <button
                                className="btn btn-sm btn-link text-decoration-none p-0"
                                style={{ fontSize: "0.8rem" }}
                                onClick={() => startEditing(row)}
                              >
                                {row.catalog_item_name ? "Change" : "Register"}
                              </button>
                            </div>
                          )}
                        </td>
                        <td data-label="Status" style={{ padding: "11px 16px" }}>
                          <span style={{
                            background: badge.bg,
                            color: badge.color,
                            borderRadius: "6px",
                            padding: "3px 10px",
                            fontWeight: 600,
                            fontSize: "0.78rem",
                            whiteSpace: "nowrap",
                          }}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default NewItemListPage;
