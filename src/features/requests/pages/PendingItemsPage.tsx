import React, { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "@shared/next-router";
import { usePurchasePaymentItems } from "@features/requests/hooks/usePurchasePaymentItems";
import { usePendingServicesContext } from "@app/providers/PendingServicesProvider";
import { useAuth } from "@app/providers/AuthProvider";
import { itemRequestAPI, serviceRequestAPI } from "../../../services/api";
import { getBsStatusBadgeClass, formatStatusLabel } from "@shared/utils/status";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import Layout from "@shared/components/Layout";
import Modal from "@shared/components/Modal";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { exportToExcel } from "@shared/utils/exportExcel";
import type { RequestDetail, ServiceRow, ItemRow } from "@shared/types";

type PendingTab = "all" | "items" | "services";

const DELIVERED_STATUSES = ["DELIVERED", "PARTIAL DELIVERED"];

/** The Active/Inactive badge's text (plain, for Excel export) — a
 * delivered-but-not-yet-released item gets its own "DELIVERED · INACTIVE"
 * label instead of the generic "INACTIVE", so it reads apart from one
 * that's already gone OUT. */
const activeStatusLabel = (status: string, isActive: boolean) => {
  if (isActive) return "ACTIVE";
  if (DELIVERED_STATUSES.includes(status)) return "DELIVERED · INACTIVE";
  return "INACTIVE";
};

/** One badge per row instead of two stacked ones — colored/labeled the same
 * way DeliveredItemsPage.module.css does for DELIVERED/PARTIAL DELIVERED,
 * so an item that's arrived but not yet released OUT reads the same green
 * "DELIVERED" pill it would on that page, just still flagged inactive here. */
const itemStatusBadge = (status: string, isActive: boolean, prType: string) => {
  if (isActive) {
    // While active, an item's delivery_status is just a placeholder equal to
    // its own pr_type (see item-request.service.ts's getPurchasePaymentItems
    // ARCH note) — echoing it back would repeat the Type column verbatim, so
    // show the human-readable "PENDING" instead. Services already carry a
    // real "PENDING" status at this point (pr_status defaults to "pending"),
    // so this is a no-op for them.
    return prType === "URGENT"
      ? { label: "PENDING", bg: "#fee2e2", color: "#991b1b" }
      : { label: "PENDING", bg: "#fef3c7", color: "#92400e" };
  }
  if (status === "DELIVERED") return { label: "DELIVERED", bg: "#d1fae5", color: "#065f46" };
  if (status === "PARTIAL DELIVERED") return { label: "PARTIAL DELIVERED", bg: "#fef3c7", color: "#92400e" };
  return { label: status || "INACTIVE", bg: "#e5e7eb", color: "#4b5563" };
};

const PendingItemsPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const [searchParams] = useSearchParams();

  // Landing on the old /dashboard/pending-services URL (bookmarks, the
  // dashboard tile) still opens straight to the Services tab; ?tab=services
  // (or ?tab=all) does the same from the merged /dashboard/pending-items URL.
  const defaultTab: PendingTab =
    searchParams.get("tab") === "all"
      ? "all"
      : location.pathname === "/dashboard/pending-services" || searchParams.get("tab") === "services"
      ? "services"
      : "items";
  const [activeTab, setActiveTab] = useState<PendingTab>(defaultTab);

  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [serviceSearchQuery, setServiceSearchQuery] = useState("");
  const [combinedSearchQuery, setCombinedSearchQuery] = useState("");
  // Segregates the Items table by pr_type (Purchase vs Payment Request) —
  // items-only, since services have no such split (see activeFilter below).
  const [itemTypeFilter, setItemTypeFilter] = useState<"all" | "PURCHASE REQUEST" | "URGENT">("all");
  // Shared across both tabs: whether the item/service is still awaiting
  // action (active) or has already moved on — delivered/released OUT for an
  // item, "finish" for a service (inactive). "all" shows both, so nothing
  // already resolved just vanishes from the list.
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");

  // ---- Pending Purchase Items ----
  // Every item ever routed through a Purchase/Payment Request — not just the
  // ones still awaiting it — so an item that's since been delivered or
  // released OUT stays visible here (as "inactive") instead of disappearing.
  const purchasePaymentItems = usePurchasePaymentItems(!!user);

  // Flattened once here (request + item fields merged into one row) so
  // search/export/render all work off the same flat list instead of each
  // re-deriving it from the nested request→items shape.
  const itemRows = useMemo(
    () =>
      purchasePaymentItems.flatMap((req) =>
        req.items.map((item, i) => ({
          key: `${req.id}-${i}`,
          requestId: req.id,
          item_name: item.item_name,
          serial: req.serial,
          pr_number: item.pr_number || "",
          qty: item.partial_qty,
          purpose: req.purpose,
          // The current state (may be "OUT"/"DELIVERED"/etc. once inactive).
          status: item.delivery_status || "",
          // The permanent snapshot of which kind of request this is — used
          // for the type tiles/filter, since `status` moves on over time.
          pr_type: item.pr_type || "",
          is_active: item.is_active,
          machine_code: item.machine_code || "",
          created_at: req.created_at,
        }))
      ),
    [purchasePaymentItems]
  );

  // Date-range-scoped but not yet search/type/active-filtered — the summary
  // tiles above the table always reflect this (the active date range),
  // regardless of what's typed in the search box or which tile is selected.
  const itemRowsInRange = useMemo(
    () => filterByDateRange(itemRows, startDate, endDate, "created_at"),
    [itemRows, startDate, endDate]
  );
  const purchaseRequestCount = useMemo(
    () => itemRowsInRange.filter((row) => row.pr_type === "PURCHASE REQUEST").length,
    [itemRowsInRange]
  );
  const paymentRequestCount = useMemo(
    () => itemRowsInRange.filter((row) => row.pr_type === "URGENT").length,
    [itemRowsInRange]
  );
  const itemActiveCount = useMemo(
    () => itemRowsInRange.filter((row) => row.is_active).length,
    [itemRowsInRange]
  );
  const itemInactiveCount = useMemo(
    () => itemRowsInRange.filter((row) => !row.is_active).length,
    [itemRowsInRange]
  );

  const filteredItemRows = useMemo(() => {
    let rows = itemRowsInRange;
    if (itemTypeFilter !== "all") rows = rows.filter((row) => row.pr_type === itemTypeFilter);
    if (activeFilter !== "all") rows = rows.filter((row) => row.is_active === (activeFilter === "active"));
    const q = itemSearchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      row.item_name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.pr_number.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q) ||
      row.machine_code.toLowerCase().includes(q)
    );
  }, [itemRowsInRange, itemTypeFilter, activeFilter, itemSearchQuery]);

  const handleExportItems = () =>
    exportToExcel(
      "purchase-payment-items",
      [
        { key: "item_name", label: "Item Name" },
        { key: "serial", label: "Serial" },
        { key: "pr_number", label: "PR No." },
        { key: "qty", label: "Qty" },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
        { key: "pr_type", label: "Type" },
        { key: "status", label: "Status" },
        { key: "active_label", label: "Active?" },
      ],
      filteredItemRows.map((row) => ({ ...row, active_label: activeStatusLabel(row.status, row.is_active) }))
    );


  // ---- Pending Services ----
  const pendingServices = usePendingServicesContext();

  const serviceRows = useMemo(
    () =>
      pendingServices.flatMap((req) =>
        req.services.map((service, i) => ({
          key: `${req.id}-${i}`,
          requestId: req.id,
          description: service.description,
          serial: req.serial,
          pr_number: req.pr_number || "",
          purpose: req.purpose,
          status: (req.pr_status || "pending").toUpperCase(),
          // Services have no Purchase-vs-Payment split — just this binary,
          // set on the request itself (see service-request.controller.ts's
          // updateServiceRequest). "pending" (the default when unset) counts
          // as still active; "finish" is the only inactive value.
          is_active: (req.pr_status || "pending").toLowerCase() !== "finish",
          created_at: req.created_at,
        }))
      ),
    [pendingServices]
  );

  // Date-range-scoped but not yet search/active-filtered — mirrors
  // itemRowsInRange, and feeds the same combined Active/Inactive tiles.
  const serviceRowsInRange = useMemo(
    () => filterByDateRange(serviceRows, startDate, endDate, "created_at"),
    [serviceRows, startDate, endDate]
  );
  const serviceActiveCount = useMemo(
    () => serviceRowsInRange.filter((row) => row.is_active).length,
    [serviceRowsInRange]
  );
  const serviceInactiveCount = useMemo(
    () => serviceRowsInRange.filter((row) => !row.is_active).length,
    [serviceRowsInRange]
  );

  const filteredServiceRows = useMemo(() => {
    let rows = serviceRowsInRange;
    if (activeFilter !== "all") rows = rows.filter((row) => row.is_active === (activeFilter === "active"));
    const q = serviceSearchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      row.description.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.pr_number.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q)
    );
  }, [serviceRowsInRange, activeFilter, serviceSearchQuery]);

  const handleExportServices = () =>
    exportToExcel(
      "pending-services",
      [
        { key: "description", label: "Description" },
        { key: "serial", label: "Serial" },
        { key: "pr_number", label: "PR No." },
        { key: "purpose", label: "Purpose" },
        { key: "status", label: "Status" },
        { key: "active_label", label: "Active?" },
      ],
      filteredServiceRows.map((row) => ({ ...row, active_label: row.is_active ? "Active" : "Inactive" }))
    );

  // ---- Pending Item & Service Requests (combined) ----
  // One unified row shape so an item line and a service line can sit in the
  // same table — kind tells them apart, qty/machine_code are blank for a
  // service the same way pr_type is blank (services have no such split).
  const combinedRows = useMemo(
    () => [
      ...itemRowsInRange.map((row) => ({
        key: `item-${row.key}`,
        requestId: row.requestId,
        kind: "Item" as const,
        name: row.item_name,
        serial: row.serial,
        pr_number: row.pr_number,
        qty: row.qty as number | null,
        purpose: row.purpose,
        status: row.status,
        pr_type: row.pr_type,
        is_active: row.is_active,
        created_at: row.created_at,
      })),
      ...serviceRowsInRange.map((row) => ({
        key: `service-${row.key}`,
        requestId: row.requestId,
        kind: "Service" as const,
        name: row.description,
        serial: row.serial,
        pr_number: row.pr_number,
        qty: null as number | null,
        purpose: row.purpose,
        status: row.status,
        pr_type: "",
        is_active: row.is_active,
        created_at: row.created_at,
      })),
    ],
    [itemRowsInRange, serviceRowsInRange]
  );

  const filteredCombinedRows = useMemo(() => {
    let rows = combinedRows;
    if (activeFilter !== "all") rows = rows.filter((row) => row.is_active === (activeFilter === "active"));
    const q = combinedSearchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      row.name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.pr_number.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q)
    );
  }, [combinedRows, activeFilter, combinedSearchQuery]);

  const handleExportCombined = () =>
    exportToExcel(
      "pending-item-and-service-requests",
      [
        { key: "kind", label: "Type" },
        { key: "name", label: "Item / Description" },
        { key: "serial", label: "Serial" },
        { key: "pr_number", label: "PR No." },
        { key: "qty", label: "Qty" },
        { key: "purpose", label: "Purpose" },
        { key: "status", label: "Status" },
        { key: "active_label", label: "Active?" },
      ],
      filteredCombinedRows.map((row) => ({ ...row, qty: row.qty ?? "", active_label: activeStatusLabel(row.status, row.is_active) }))
    );

  const openCombinedRow = (row: (typeof combinedRows)[number]) =>
    row.kind === "Item" ? openItemDetails(row.requestId) : openServiceDetails(row.requestId);

  // Fetched fresh on click rather than deep-linking to another dashboard —
  // that route required guessing which tab/list a given role lands on and
  // waiting for that page's own (sometimes cached) data to include the row.
  // A direct getById call here shows the same details immediately, for
  // every role, with none of that.
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [detailKind, setDetailKind] = useState<"item" | "service" | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const openItemDetails = async (requestId: number) => {
    setSelectedRequestId(requestId);
    setDetailKind("item");
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const response = await itemRequestAPI.getById(requestId);
      setDetail(response.data as RequestDetail);
    } catch {
      setDetailError("Failed to load this item request's details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const openServiceDetails = async (requestId: number) => {
    setSelectedRequestId(requestId);
    setDetailKind("service");
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const response = await serviceRequestAPI.getById(requestId);
      setDetail(response.data as RequestDetail);
    } catch {
      setDetailError("Failed to load this service request's details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetails = () => {
    setSelectedRequestId(null);
    setDetailKind(null);
    setDetail(null);
    setDetailError(null);
  };

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Pending Purchase Items &amp; Services</h1>
            <p className="dash-subtitle" style={{ color: "#856404" }}>
              Items routed through a Purchase or Payment Request — including ones already delivered or
              released — and services awaiting a Purchase Request or Payment Request
            </p>
          </div>
        </div>

        {/* Combined across items AND services — the only dimension both
            share (services have no Purchase-vs-Payment split, see
            serviceRows above). Selecting a pill filters whichever tab is
            currently open. */}
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span className="text-muted small fw-semibold">Purchase &amp; Payment Requests:</span>
          {([
            { key: "all" as const, label: "All", count: itemRowsInRange.length + serviceRowsInRange.length },
            { key: "active" as const, label: "Active — still awaiting action", count: itemActiveCount + serviceActiveCount },
            { key: "inactive" as const, label: "Inactive — delivered, released, or finished", count: itemInactiveCount + serviceInactiveCount },
          ]).map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => setActiveFilter(tile.key)}
              style={{
                background: activeFilter === tile.key ? "#111827" : "#f3f4f6",
                color: activeFilter === tile.key ? "#fff" : "#374151",
                border: "none",
                borderRadius: "999px",
                padding: "6px 14px",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {tile.label} ({tile.count})
            </button>
          ))}
        </div>

        <div className="dash-tabs mb-4">
          <button
            className={`dash-tab ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            Pending Item &amp; Service Requests
            <span className="dash-tab-badge">{itemRows.length + serviceRows.length}</span>
          </button>
          <button
            className={`dash-tab ${activeTab === "items" ? "active" : ""}`}
            onClick={() => setActiveTab("items")}
          >
            Pending Purchase Items
            <span className="dash-tab-badge">{itemRows.length}</span>
          </button>
          <button
            className={`dash-tab ${activeTab === "services" ? "active" : ""}`}
            onClick={() => setActiveTab("services")}
          >
            Pending Services
            <span className="dash-tab-badge">{serviceRows.length}</span>
          </button>
        </div>

        {activeTab === "all" ? (
          <>
            <ListToolbar
              searchQuery={combinedSearchQuery}
              onSearchChange={setCombinedSearchQuery}
              searchPlaceholder="Search by Item Name, Description, Serial, PR No., or Purpose..."
              onExport={handleExportCombined}
              exportDisabled={filteredCombinedRows.length === 0}
            />

            <div className="mb-4">
              <DateRangeFilter />
            </div>

            <div style={{ border: "1px solid #ffc107", borderRadius: "10px", overflow: "hidden" }}>
              {combinedRows.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-inbox" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No pending item or service requests found.</p>
                </div>
              ) : filteredCombinedRows.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No requests match your search and filters.</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <thead>
                      <tr style={{ background: "#fef9c3", borderBottom: "2px solid #fde68a" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Type</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Item / Description</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Serial</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>PR No.</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Qty</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Purpose</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCombinedRows.map((row, i) => (
                        <tr
                          key={row.key}
                          onClick={() => openCombinedRow(row)}
                          title={`Open ${row.serial}`}
                          style={{ borderBottom: "1px solid #fde68a", background: i % 2 === 0 ? "#fffdf5" : "#fff", cursor: "pointer" }}
                        >
                          <td data-label="Type" style={{ padding: "11px 16px" }}>
                            <span style={{
                              background: row.kind === "Item" ? "#e0e7ff" : "#fce7f3",
                              color: row.kind === "Item" ? "#3730a3" : "#9d174d",
                              borderRadius: "6px",
                              padding: "3px 10px",
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              whiteSpace: "nowrap",
                            }}>
                              {row.kind}
                            </span>
                          </td>
                          <td data-label="Item / Description" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.name}</td>
                          <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                          <td data-label="PR No." style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.pr_number || "—"}</td>
                          <td data-label="Qty" style={{ padding: "11px 16px", fontWeight: 600, color: "#92400e" }}>{row.qty ?? "—"}</td>
                          <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                          <td data-label="Status" style={{ padding: "11px 16px" }}>
                            {(() => {
                              const badge = itemStatusBadge(row.status, row.is_active, row.pr_type);
                              return (
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
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : activeTab === "items" ? (
          <>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {([
                { key: "all" as const, label: "All Purchase/Payment Items", count: itemRowsInRange.length, bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" },
                { key: "PURCHASE REQUEST" as const, label: "Purchase Request", count: purchaseRequestCount, bg: "#fef3c7", border: "#fde68a", text: "#92400e" },
                { key: "URGENT" as const, label: "Urgent Item", count: paymentRequestCount, bg: "#fee2e2", border: "#fecaca", text: "#991b1b" },
              ]).map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => setItemTypeFilter(tile.key)}
                  style={{
                    flex: "1 1 180px",
                    minWidth: "160px",
                    textAlign: "left",
                    background: tile.bg,
                    border: `2px solid ${itemTypeFilter === tile.key ? tile.text : tile.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    cursor: "pointer",
                    boxShadow: itemTypeFilter === tile.key ? "0 2px 6px rgba(0,0,0,0.12)" : "none",
                  }}
                >
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: tile.text, lineHeight: 1.2 }}>{tile.count}</div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600, color: tile.text, opacity: 0.85 }}>{tile.label}</div>
                </button>
              ))}
            </div>

            <ListToolbar
              searchQuery={itemSearchQuery}
              onSearchChange={setItemSearchQuery}
              searchPlaceholder="Search by Item Name, Serial, PR No., Purpose, Machine Code, or Status..."
              onExport={handleExportItems}
              exportDisabled={filteredItemRows.length === 0}
            />

            <div className="mb-4">
              <DateRangeFilter />
            </div>

            <div style={{ border: "1px solid #ffc107", borderRadius: "10px", overflow: "hidden" }}>
              {itemRowsInRange.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-inbox" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No purchase or payment request items found.</p>
                </div>
              ) : filteredItemRows.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No items match your search and filters.</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <thead>
                      <tr style={{ background: "#fef9c3", borderBottom: "2px solid #fde68a" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Item Name</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Serial</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>PR No.</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Qty</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Purpose</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Machine Code</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Type</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItemRows.map((row, i) => (
                        <tr
                          key={row.key}
                          onClick={() => openItemDetails(row.requestId)}
                          title={`Open ${row.serial}`}
                          style={{ borderBottom: "1px solid #fde68a", background: i % 2 === 0 ? "#fffdf5" : "#fff", cursor: "pointer" }}
                        >
                          <td data-label="Item Name" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_name}</td>
                          <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                          <td data-label="PR No." style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.pr_number || "—"}</td>
                          <td data-label="Qty" style={{ padding: "11px 16px", fontWeight: 600, color: "#92400e" }}>{row.qty}</td>
                          <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                          <td data-label="Machine Code" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.machine_code || "—"}</td>
                          <td data-label="Type" style={{ padding: "11px 16px" }}>
                            <span style={{
                              background: row.pr_type === "PURCHASE REQUEST" ? "#fef3c7" : "#fee2e2",
                              color: row.pr_type === "PURCHASE REQUEST" ? "#92400e" : "#991b1b",
                              borderRadius: "6px",
                              padding: "3px 10px",
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              whiteSpace: "nowrap",
                            }}>
                              {row.pr_type || "—"}
                            </span>
                          </td>
                          <td data-label="Status" style={{ padding: "11px 16px" }}>
                            {(() => {
                              const badge = itemStatusBadge(row.status, row.is_active, row.pr_type);
                              return (
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
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <ListToolbar
              searchQuery={serviceSearchQuery}
              onSearchChange={setServiceSearchQuery}
              searchPlaceholder="Search by Description, Serial, PR No., Purpose, or Status..."
              onExport={handleExportServices}
              exportDisabled={filteredServiceRows.length === 0}
            />

            <div className="mb-4">
              <DateRangeFilter />
            </div>

            <div style={{ border: "1px solid #ffc107", borderRadius: "10px", overflow: "hidden" }}>
              {pendingServices.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-inbox" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No pending services found.</p>
                </div>
              ) : filteredServiceRows.length === 0 ? (
                <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                  <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>No services match your search.</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <thead>
                      <tr style={{ background: "#fef9c3", borderBottom: "2px solid #fde68a" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Description</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Serial</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>PR No.</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Purpose</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#78350f", fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredServiceRows.map((row, i) => (
                        <tr
                          key={row.key}
                          onClick={() => openServiceDetails(row.requestId)}
                          title={`Open ${row.serial}`}
                          style={{ borderBottom: "1px solid #fde68a", background: i % 2 === 0 ? "#fffdf5" : "#fff", cursor: "pointer" }}
                        >
                          <td data-label="Description" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.description}</td>
                          <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                          <td data-label="PR No." style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.pr_number || "—"}</td>
                          <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                          <td data-label="Status" style={{ padding: "11px 16px" }}>
                            <span style={{
                              background: row.is_active ? "#fef3c7" : "#e5e7eb",
                              color: row.is_active ? "#92400e" : "#4b5563",
                              borderRadius: "6px",
                              padding: "3px 10px",
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              whiteSpace: "nowrap",
                            }}>
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={selectedRequestId !== null}
        onClose={closeDetails}
        title={
          detail?.serial
            ? `${detailKind === "item" ? "Item" : "Service"} Request — ${detail.serial}`
            : detailKind === "item" ? "Item Request" : "Service Request"
        }
      >
        {loadingDetail ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af" }}>Loading…</div>
        ) : detailError ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#b91c1c" }}>{detailError}</div>
        ) : detail ? (
          <div>
            <div className="border rounded p-3 mb-3 bg-light">
              <div className="fw-semibold text-secondary small text-uppercase mb-3">Request Information</div>
              <div className="row g-3">
                <div className="col-12 col-sm-6 col-md">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>Department</div>
                  <div className="fw-semibold">{detail.department || "—"}</div>
                </div>
                <div className="col-12 col-sm-6 col-md">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>Requested By</div>
                  <div>{detail.requested_by || "—"}</div>
                </div>
                <div className="col-12 col-sm-6 col-md">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>Status</div>
                  <span className={`badge ${getBsStatusBadgeClass(detail.status)}`}>{detail.status || "—"}</span>
                </div>
                <div className="col-12">
                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>Purpose</div>
                  <div>{sanitizeUserInput(detail.purpose || "—")}</div>
                </div>
                {detail.remarks && (
                  <div className="col-12">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>Remarks</div>
                    <div>{sanitizeUserInput(detail.remarks)}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="border rounded p-3 mb-3">
              <div className="row g-3">
                <div className="col-12 col-sm-6">
                  <div className="fw-semibold text-secondary small text-uppercase mb-2">Supervisor</div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>Status</div>
                  {detail.supervisor_status ? (
                    <span className={`badge ${getBsStatusBadgeClass(detail.supervisor_status)}`}>{formatStatusLabel(detail.supervisor_status)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>Approved By</div>
                  <div>{detail.supervisor_name || detail.supervisor_approved_by_name || "—"}</div>
                  <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>Approved Date</div>
                  <div>{detail.supervisor_approved_at ? new Date(detail.supervisor_approved_at).toISOString().split("T")[0] : "—"}</div>
                </div>
                <div className="col-12 col-sm-6">
                  <div className="fw-semibold text-secondary small text-uppercase mb-2">Custodian</div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>Status</div>
                  {detail.custodian_status ? (
                    <span className={`badge ${getBsStatusBadgeClass(detail.custodian_status)}`}>{formatStatusLabel(detail.custodian_status)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>Approved By</div>
                  <div>{detail.custodian_name || detail.custodian_approved_by_name || "—"}</div>
                  <div className="text-muted mt-2" style={{ fontSize: "0.72rem" }}>Approved Date</div>
                  <div>{detail.custodian_approved_at ? new Date(detail.custodian_approved_at).toISOString().split("T")[0] : "—"}</div>
                </div>
              </div>
              {detail.rejection_comment && (
                <div className="mt-3 pt-3 border-top">
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>Declined Comment</div>
                  <div className="text-danger fw-medium">{detail.rejection_comment}</div>
                </div>
              )}
            </div>

            {detailKind === "service" && (
              <div className="border rounded p-3 mb-3">
                <div className="fw-semibold text-secondary small text-uppercase mb-3">Purchase Request</div>
                <div className="row g-3">
                  <div className="col-12 col-sm-6">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>PR Number</div>
                    <div>{detail.pr_number || "—"}</div>
                  </div>
                  <div className="col-12 col-sm-6">
                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>PR Status</div>
                    <div>{detail.pr_status || "—"}</div>
                  </div>
                  {detail.pr_number_updated_by_name && (
                    <>
                      <div className="col-12 col-sm-6">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Custodian (Entered By)</div>
                        <div>{detail.pr_number_updated_by_name}</div>
                      </div>
                      <div className="col-12 col-sm-6">
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>Date Entered</div>
                        <div>{detail.pr_number_updated_at ? new Date(detail.pr_number_updated_at).toISOString().split("T")[0] : "—"}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {detailKind === "item" ? (
              <div>
                <h5 className="mb-3">Items</h5>
                <div className="table-responsive">
                  <table className="table table-sm" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                    <thead style={{ backgroundColor: "#f8f9fa" }}>
                      <tr>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>#</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Item Name</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Quantity</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>UoM</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Remarks</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Machine Code</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>PR No.</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((item: ItemRow, index: number) => (
                        <tr key={item.id ?? index} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                          <td style={{ padding: "10px" }}>{index + 1}</td>
                          <td style={{ padding: "10px" }}>{sanitizeUserInput(item.item_name || "—")}</td>
                          <td style={{ padding: "10px" }}>{item.quantity}</td>
                          <td style={{ padding: "10px" }}>{sanitizeUserInput(item.uom || "—")}</td>
                          <td style={{ padding: "10px" }}>{sanitizeUserInput(item.remarks || "—")}</td>
                          <td style={{ padding: "10px" }}>{item.machine_code || "—"}</td>
                          <td style={{ padding: "10px" }}>{item.pr_number || "—"}</td>
                          <td style={{ padding: "10px" }}>
                            <span className={`badge ${getBsStatusBadgeClass(item.delivery_status)}`}>{item.delivery_status || "pending"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div>
                <h5 className="mb-3">Services</h5>
                <div className="table-responsive">
                  <table className="table table-sm" style={{ borderCollapse: "separate", borderSpacing: "0", border: "1px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
                    <thead style={{ backgroundColor: "#f8f9fa" }}>
                      <tr>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>#</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Description</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Status</th>
                        <th style={{ padding: "10px", border: "none", borderBottom: "1px solid #e0e0e0", fontWeight: "600", color: "#495057" }}>Receiving Report No.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.services || []).map((service: ServiceRow, index: number) => (
                        <tr key={service.id ?? index} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa", borderBottom: "1px solid #e0e0e6" }}>
                          <td style={{ padding: "10px" }}>{index + 1}</td>
                          <td style={{ padding: "10px" }}>{sanitizeUserInput(service.description || "—")}</td>
                          <td style={{ padding: "10px" }}>
                            <span className={`badge ${getBsStatusBadgeClass(service.delivery_status)}`}>{service.delivery_status || "pending"}</span>
                          </td>
                          <td style={{ padding: "10px" }}>
                            {service.receiving_report_no || "—"}
                            {service.receiving_report_no_updated_by_name && (
                              <div className="text-muted mt-1" style={{ fontSize: "0.72rem" }}>
                                By {service.receiving_report_no_updated_by_name}
                                {service.receiving_report_no_updated_at && ` · ${new Date(service.receiving_report_no_updated_at).toISOString().split("T")[0]}`}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </Layout>
  );
};

export default PendingItemsPage;
