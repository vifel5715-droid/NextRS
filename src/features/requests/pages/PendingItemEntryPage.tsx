import React, { useMemo, useState } from "react";
import { usePurchasePaymentItems } from "@features/requests/hooks/usePurchasePaymentItems";
import { useItemCatalogNames } from "@features/item-catalog/hooks/useItemCatalogNames";
import { useAuth } from "@app/providers/AuthProvider";
import Layout from "@shared/components/Layout";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { exportToExcel } from "@shared/utils/exportExcel";
import { formatDate } from "@shared/utils/format";
import { itemRequestAPI } from "../../../services/api";
import { getErrorMessage } from "@shared/utils/errorMessage";

/**
 * "Pending Item Entry" — Item Request System items already classified both
 * Payment Request (see UrgentItemsPage.tsx's Transaction Type) and
 * Inventoriable (real trackable stock, not a one-off consumable). These were
 * bought without an existing Item Catalog entry to match, so the custodian
 * registers which catalog entry each one corresponds to here before it can
 * be tracked like any other catalog item — see item-request.service.ts's
 * updateItemCatalogLink.
 */
const PendingItemEntryPage: React.FC = () => {
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState<"all" | "pending" | "registered">("all");

  const purchasePaymentItems = usePurchasePaymentItems(!!user);
  const catalogNames = useItemCatalogNames();

  // Inline per-item registration editor — one row editable at a time.
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [draftCatalogName, setDraftCatalogName] = useState("");
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      purchasePaymentItems.flatMap((req) =>
        req.items
          .filter((item) => item.purchasing_transaction === "payment_request" && item.is_inventoriable)
          .map((item, i) => ({
            key: `${req.id}-${i}`,
            id: item.id,
            item_name: item.item_name,
            serial: req.serial,
            quantity: item.quantity,
            uom: item.uom,
            amount: item.amount,
            date_needed: item.date_needed || "",
            purpose: req.purpose,
            status: item.delivery_status || "",
            machine_code: item.machine_code || "",
            catalog_item_name: item.catalog_item_name || "",
            created_at: req.created_at,
          })),
      ),
    [purchasePaymentItems]
  );

  const startEditing = (row: { id: number; catalog_item_name: string }) => {
    setEditingItemId(row.id);
    setDraftCatalogName(row.catalog_item_name);
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setDraftCatalogName("");
  };

  const saveEditing = async () => {
    if (!editingItemId) return;
    setSavingItemId(editingItemId);
    try {
      await itemRequestAPI.setItemCatalogLink(editingItemId, { catalog_item_name: draftCatalogName });
      cancelEditing();
    } catch (error: unknown) {
      alert("Error saving registered catalog item: " + getErrorMessage(error));
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
      row.item_name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.machine_code.toLowerCase().includes(q) ||
      row.catalog_item_name.toLowerCase().includes(q)
    );
  }, [rowsInRange, entryFilter, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      "pending-item-entry",
      [
        { key: "item_name", label: "Item Name" },
        { key: "quantity", label: "Qty" },
        { key: "uom", label: "UoM" },
        { key: "serial", label: "Serial" },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
        { key: "amount", label: "Amount" },
        { key: "date_needed", label: "Date Needed" },
        { key: "catalog_item_name", label: "Registered Catalog Item" },
        { key: "created_at", label: "Date Created" },
      ],
      filteredRows.map((row) => ({
        ...row,
        amount: row.amount ? `₱${Number(row.amount).toFixed(2)}` : "N/A",
        date_needed: row.date_needed ? new Date(row.date_needed).toLocaleDateString() : "N/A",
        catalog_item_name: row.catalog_item_name || "Not Registered",
        created_at: formatDate(row.created_at),
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Pending Item Entry</h1>
            <p className="dash-subtitle" style={{ color: "#1e40af" }}>
              Payment Request items marked Inventoriable — register each one against its Item Catalog entry
            </p>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {([
            { key: "all" as const, label: "All Pending Item Entries", count: rowsInRange.length },
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
                background: "#dbeafe",
                border: `2px solid ${entryFilter === tile.key ? "#1e40af" : "#bfdbfe"}`,
                borderRadius: "10px",
                padding: "10px 14px",
                cursor: "pointer",
                boxShadow: entryFilter === tile.key ? "0 2px 6px rgba(0,0,0,0.12)" : "none",
              }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1e40af", lineHeight: 1.2 }}>{tile.count}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#1e40af", opacity: 0.85 }}>{tile.label}</div>
            </button>
          ))}
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item Name, Serial, Purpose, Machine Code, or Registered Item..."
          onExport={handleExport}
          exportDisabled={filteredRows.length === 0}
        />

        <div className="mb-3">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #bfdbfe", borderRadius: "10px", overflow: "hidden" }}>
          {rowsInRange.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-box-seam" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No pending item entries found.</p>
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
                  <tr style={{ background: "#dbeafe", borderBottom: "2px solid #bfdbfe" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Item Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>UoM</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Purpose</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Machine Code</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Amount</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Date Needed</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Registered Catalog Item</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => {
                    const isEditing = editingItemId === row.id;
                    return (
                      <tr
                        key={row.key}
                        style={{ borderBottom: "1px solid #bfdbfe", background: i % 2 === 0 ? "#eff6ff" : "#fff" }}
                      >
                        <td data-label="Item Name" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_name}</td>
                        <td data-label="Qty" style={{ padding: "11px 16px", fontWeight: 600 }}>{row.quantity}</td>
                        <td data-label="UoM" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.uom}</td>
                        <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                        <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                        <td data-label="Machine Code" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.machine_code || "—"}</td>
                        <td data-label="Amount" style={{ padding: "11px 16px", fontWeight: 600, color: "#5b21b6" }}>{row.amount ? `₱${Number(row.amount).toFixed(2)}` : "—"}</td>
                        <td data-label="Date Needed" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date_needed ? new Date(row.date_needed).toLocaleDateString() : "—"}</td>
                        <td data-label="Registered Catalog Item" style={{ padding: "11px 16px" }}>
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
                                  onEnter={saveEditing}
                                />
                              </div>
                              <button
                                className="btn btn-sm btn-success"
                                disabled={savingItemId === row.id}
                                onClick={saveEditing}
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

export default PendingItemEntryPage;
