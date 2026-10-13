import React, { useMemo, useState } from "react";
import { useOutedItemsContext } from "@/components/providers/OutedItemsProvider";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { formatDate, formatMilitaryTime } from "@/lib/utils/format";

const OutedItemsPage: React.FC = () => {
  const outedItems = useOutedItemsContext();
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");

  const rows = useMemo(
    () =>
      outedItems.flatMap((req) =>
        req.items.map((item, i) => ({
          key: `${req.id}-${i}`,
          item_name: item.item_name,
          serial: req.serial,
          issuance_number: item.issuance_number || "",
          qty_out: item.quantity_out ?? 0,
          purpose: req.purpose,
          machine_code: item.machine_code || "",
          date: item.issued_at ? `${formatDate(item.issued_at)} ${formatMilitaryTime(item.issued_at)}` : "",
          issued_at: item.issued_at,
        }))
      ),
    [outedItems]
  );

  const filteredRows = useMemo(() => {
    const inRange = filterByDateRange(rows, startDate, endDate, "issued_at");
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inRange;
    return inRange.filter((row) =>
      row.item_name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.issuance_number.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.machine_code.toLowerCase().includes(q)
    );
  }, [rows, searchQuery, startDate, endDate]);

  const handleExport = () =>
    exportToExcel(
      "outed-items",
      [
        { key: "item_name", label: "Item Name" },
        { key: "date", label: "Date" },
        { key: "serial", label: "Serial" },
        { key: "issuance_number", label: "Issuance No." },
        { key: "qty_out", label: "Qty Out" },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
      ],
      filteredRows
    );

  return (
    <>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Issued List of Item</h1>
            <p className="dash-subtitle" style={{ color: "#1e40af" }}>
              Items released (issued OUT) to the requester
            </p>
          </div>
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item Name, Serial, Issuance No., Purpose, or Machine Code..."
          onExport={handleExport}
          exportDisabled={filteredRows.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #60a5fa", borderRadius: "10px", overflow: "hidden" }}>
          {outedItems.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-box-arrow-right" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No outed items found.</p>
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
                  <tr style={{ background: "#dbeafe", borderBottom: "2px solid #93c5fd" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Item Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Date</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Issuance No.</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Qty Out</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Purpose</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Machine Code</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#1e40af", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr
                      key={row.key}
                      style={{ borderBottom: "1px solid #93c5fd", background: i % 2 === 0 ? "#f5f9ff" : "#fff" }}
                    >
                      <td data-label="Item Name" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_name}</td>
                      <td data-label="Date" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date || "—"}</td>
                      <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                      <td data-label="Issuance No." style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.issuance_number || "—"}</td>
                      <td data-label="Qty Out" style={{ padding: "11px 16px", fontWeight: 600, color: "#1e40af" }}>{row.qty_out}</td>
                      <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                      <td data-label="Machine Code" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.machine_code || "—"}</td>
                      <td data-label="Status" style={{ padding: "11px 16px" }}>
                        <span style={{
                          background: "#dbeafe",
                          color: "#1e40af",
                          borderRadius: "6px",
                          padding: "3px 10px",
                          fontWeight: 600,
                          fontSize: "0.78rem",
                          whiteSpace: "nowrap",
                        }}>
                          OUT
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
    </>
  );
};

export default OutedItemsPage;
