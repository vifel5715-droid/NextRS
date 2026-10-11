import React, { useMemo, useState } from "react";
import { useDeletionLog } from "@features/items/hooks/useDeletionLog";
import { useAuth } from "@app/providers/AuthProvider";
import Layout from "@shared/components/Layout";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { exportToExcel } from "@shared/utils/exportExcel";

interface DeletedExportRow {
  request_serial: string;
  department: string;
  entity_name: string;
  quantity: number | string;
  uom: string;
  issued_by_name: string;
  reason: string;
  deleted_by_name: string;
  deleted_at_formatted: string;
}

const DeletedItemsPage: React.FC = () => {
  const { entries, loading } = useDeletionLog();
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isCustodian = role === "custodian" || role === "admin" || role === "director";
  const [activeTab, setActiveTab] = useState<"item" | "service" | "audit" | "rr">("item");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEntries = useMemo(() => {
    const byTab = filterByDateRange(
      entries.filter((entry) => entry.request_type === activeTab),
      startDate, endDate, "deleted_at"
    );
    if (!searchQuery.trim()) return byTab;
    const q = searchQuery.toLowerCase();
    return byTab.filter((entry) =>
      (entry.request_serial?.toLowerCase() || "").includes(q) ||
      (entry.entity_name?.toLowerCase() || "").includes(q) ||
      (entry.department?.toLowerCase() || "").includes(q) ||
      (entry.reason?.toLowerCase() || "").includes(q) ||
      (entry.deleted_by_name?.toLowerCase() || "").includes(q)
    );
  }, [entries, activeTab, searchQuery, startDate, endDate]);

  // Column set differs per tab (item/service carry Qty/UoM, audit/rr carry
  // Issued By/Entered By instead) — shared between the on-screen table and
  // the Excel export so they never drift apart.
  const exportColumns = useMemo(() => {
    const cols: { key: keyof DeletedExportRow; label: string }[] = [
      { key: "request_serial", label: "Serial" },
      { key: "department", label: "Department" },
      {
        key: "entity_name",
        label: activeTab === "item" ? "Item" : activeTab === "service" ? "Service" : activeTab === "rr" ? "Receiving Report" : "Issuance",
      },
    ];
    if (activeTab !== "service" && activeTab !== "rr") {
      cols.push({ key: "quantity", label: "Qty" }, { key: "uom", label: "UoM" });
    }
    if (activeTab === "audit") cols.push({ key: "issued_by_name", label: "Issued By" });
    if (activeTab === "rr") cols.push({ key: "issued_by_name", label: "Entered By" });
    cols.push(
      { key: "reason", label: "Reason" },
      { key: "deleted_by_name", label: "Deleted By" },
      { key: "deleted_at_formatted", label: "Deleted At" }
    );
    return cols;
  }, [activeTab]);

  const handleExport = () =>
    exportToExcel(
      `deleted-${activeTab}`,
      exportColumns,
      filteredEntries.map((entry) => ({
        request_serial: entry.request_serial || "",
        department: entry.department || "",
        entity_name: entry.entity_name || "",
        quantity: entry.quantity ?? "",
        uom: entry.uom ?? "",
        issued_by_name: entry.issued_by_name ?? "",
        reason: entry.reason || "",
        deleted_by_name: entry.deleted_by_name || "",
        deleted_at_formatted: entry.deleted_at ? new Date(entry.deleted_at).toISOString().split("T")[0] : "",
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="dash-title">DELETED</h1>
            </div>
          </div>
        </div>

        <div className="dash-tabs mb-3">
          <button type="button" className={`dash-tab ${activeTab === "item" ? "active" : ""}`} onClick={() => setActiveTab("item")}>
            Deleted Items
          </button>
          <button type="button" className={`dash-tab ${activeTab === "service" ? "active" : ""}`} onClick={() => setActiveTab("service")}>
            Deleted Services
          </button>
          {isCustodian && (
            <button type="button" className={`dash-tab ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}>
              Deleted Issuance No #
            </button>
          )}
          {isCustodian && (
            <button type="button" className={`dash-tab ${activeTab === "rr" ? "active" : ""}`} onClick={() => setActiveTab("rr")}>
              Deleted RR No.
            </button>
          )}
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Serial, Item/Service, Reason, Deleted By..."
          onExport={handleExport}
          exportDisabled={filteredEntries.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #fca5a5", borderRadius: "10px", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>Loading...</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-trash" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>
                {entries.filter((e) => e.request_type === activeTab).length === 0
                  ? `No deleted ${activeTab === "item" ? "items" : activeTab === "service" ? "services" : activeTab === "rr" ? "receiving report numbers" : "issuance records"} recorded.`
                  : "No deletions match your search."}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#fee2e2", borderBottom: "2px solid #fca5a5" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Department</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>
                      {activeTab === "item" ? "Item" : activeTab === "service" ? "Service" : activeTab === "rr" ? "Receiving Report" : "Issuance"}
                    </th>
                    {activeTab !== "service" && activeTab !== "rr" && (
                      <>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Qty</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>UoM</th>
                      </>
                    )}
                    {activeTab === "audit" && (
                      <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Issued By</th>
                    )}
                    {activeTab === "rr" && (
                      <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Entered By</th>
                    )}
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Reason</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Deleted By</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Deleted At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, i) => (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: "1px solid #fecaca", background: i % 2 === 0 ? "#fff5f5" : "#fff" }}
                    >
                      <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{entry.request_serial}</td>
                      <td data-label="Department" style={{ padding: "11px 16px" }}>{entry.department}</td>
                      <td data-label={activeTab === "item" ? "Item" : activeTab === "service" ? "Service" : activeTab === "rr" ? "Receiving Report" : "Issuance"} style={{ padding: "11px 16px", fontWeight: 500 }}>{entry.entity_name}</td>
                      {activeTab !== "service" && activeTab !== "rr" && (
                        <>
                          <td data-label="Qty" style={{ padding: "11px 16px" }}>{entry.quantity ?? "—"}</td>
                          <td data-label="UoM" style={{ padding: "11px 16px" }}>{entry.uom ?? "—"}</td>
                        </>
                      )}
                      {activeTab === "audit" && (
                        <td data-label="Issued By" style={{ padding: "11px 16px" }}>{entry.issued_by_name ?? "—"}</td>
                      )}
                      {activeTab === "rr" && (
                        <td data-label="Entered By" style={{ padding: "11px 16px" }}>{entry.issued_by_name ?? "—"}</td>
                      )}
                      <td data-label="Reason" style={{ padding: "11px 16px", color: "#6b7280" }}>{entry.reason}</td>
                      <td data-label="Deleted By" style={{ padding: "11px 16px" }}>{entry.deleted_by_name ?? "—"}</td>
                      <td data-label="Deleted At" style={{ padding: "11px 16px", color: "#6b7280" }}>
                        {entry.deleted_at ? new Date(entry.deleted_at).toISOString().split("T")[0] : ""}
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

export default DeletedItemsPage;
