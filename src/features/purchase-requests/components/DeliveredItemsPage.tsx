import React, { useMemo, useState } from "react";
import { useDeliveredItemsContext } from "@/components/providers/DeliveredItemsProvider";
import Layout from "@/components/layout/Layout";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { formatDate, formatMilitaryTime } from "@/lib/utils/format";
import styles from "@/features/purchase-requests/components/DeliveredItemsPage.module.css";

const DeliveredItemsPage: React.FC = () => {
  const deliveredItems = useDeliveredItemsContext();
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");

  const rows = useMemo(
    () =>
      deliveredItems.flatMap((req) =>
        req.items.map((item, i) => ({
          key: `${req.id}-${i}`,
          item_name: item.item_name,
          serial: req.serial,
          pr_number: item.pr_number || "",
          purpose: req.purpose,
          status: item.is_partial ? "PARTIAL DELIVERED" : "DELIVERED",
          machine_code: item.machine_code || "",
          // "PURCHASE REQUEST" | "URGENT" — permanent snapshot, see
          // item_request_items.pr_type.
          pr_type: item.pr_type || "",
          created_at: req.created_at,
          date_received: item.date_received || "",
        }))
      ),
    [deliveredItems]
  );

  const filteredRows = useMemo(() => {
    const inRange = filterByDateRange(rows, startDate, endDate, "created_at");
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inRange;
    return inRange.filter((row) =>
      row.item_name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.pr_number.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q) ||
      row.machine_code.toLowerCase().includes(q) ||
      row.pr_type.toLowerCase().includes(q)
    );
  }, [rows, searchQuery, startDate, endDate]);

  const handleExport = () =>
    exportToExcel(
      "delivered-items",
      [
        { key: "item_name", label: "Item Name" },
        { key: "created_at", label: "Date Created" },
        { key: "date_received", label: "Date Received" },
        { key: "serial", label: "Serial" },
        { key: "pr_number", label: "PR No." },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
        { key: "pr_type", label: "Type" },
        { key: "status", label: "Status" },
      ],
      filteredRows.map((row) => ({
        ...row,
        created_at: formatDate(row.created_at),
        date_received: row.date_received ? `${formatDate(row.date_received)} ${formatMilitaryTime(row.date_received)}` : "",
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Delivered Purchase Items</h1>
            <p className="dash-subtitle" style={{ color: "#065f46" }}>
              Items that have been delivered
            </p>
          </div>
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item Name, Serial, PR No., Purpose, Machine Code, or Status..."
          onExport={handleExport}
          exportDisabled={filteredRows.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #34d399", borderRadius: "10px", overflow: "hidden" }}>
          {deliveredItems.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-box-seam" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No delivered items found.</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No items match your search.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#d1fae5", borderBottom: "2px solid #6ee7b7" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Item Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Date Created</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Date Received</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>PR No.</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Purpose</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Machine Code</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Type</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr
                      key={row.key}
                      style={{ borderBottom: "1px solid #6ee7b7", background: i % 2 === 0 ? "#f0fdf9" : "#fff" }}
                    >
                      <td data-label="Item Name" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_name}</td>
                      <td data-label="Date Created" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                      <td data-label="Date Received" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date_received ? `${formatDate(row.date_received)} ${formatMilitaryTime(row.date_received)}` : "—"}</td>
                      <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                      <td data-label="PR No." style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.pr_number || "—"}</td>
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
                        <span className={`${styles.statusBadge} ${row.status === "PARTIAL DELIVERED" ? styles.statusBadgePartial : styles.statusBadgeDelivered}`}>
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
      </div>
    </Layout>
  );
};

export default DeliveredItemsPage;
