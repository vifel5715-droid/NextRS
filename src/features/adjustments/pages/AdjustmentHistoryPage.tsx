import React, { useMemo, useState } from "react";
import Layout from "@shared/components/Layout";
import ListToolbar from "@shared/components/ListToolbar";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { useAdjustmentLog } from "../hooks/useAdjustmentLog";
import { exportToExcel } from "@shared/utils/exportExcel";
import { formatMilitaryDateTime } from "@shared/utils/format";

/**
 * System-wide adjustment history as its own sidebar page — every Item Name/
 * Quantity/UoM/Remarks/Machine Code correction ever recorded, across every
 * request (department-scoped for staff/secretary/supervisor/manager, same as
 * the Deleted page). The per-request AdjustmentHistoryModal this is the
 * full-list sibling of is unaffected — that one still opens contextually
 * from a single request.
 */
const AdjustmentHistoryPage: React.FC = () => {
  const { entries, loading } = useAdjustmentLog();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      (entry.request_serial || "").toLowerCase().includes(q) ||
      (entry.adjustment_serial || "").toLowerCase().includes(q) ||
      entry.item_label.toLowerCase().includes(q) ||
      entry.field.toLowerCase().includes(q) ||
      (entry.before_value || "").toLowerCase().includes(q) ||
      (entry.after_value || "").toLowerCase().includes(q) ||
      entry.adjustment_remarks.toLowerCase().includes(q) ||
      entry.adjusted_by_name.toLowerCase().includes(q) ||
      entry.adjusted_by_department.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  // One Save click can change several tracked fields on the SAME item — the
  // server (adjustmentLog.ts's logItemAdjustments) writes one row per changed
  // field but shares a single adjustment_serial across all of them, so the
  // list otherwise repeats Adjustment No./Serial/Item/Remarks/Adjusted By
  // once per field. Grouped here by adjustment_serial + item_label (NOT
  // adjustment_serial alone — a batch "Save All" can share one serial across
  // several DIFFERENT items, which must stay separate rows) so each save
  // shows as one row with every changed field listed inside it. Rows with no
  // adjustment_serial (pre-dates the column, never backfilled) are never
  // merged with each other, keyed by their own id instead.
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      adjustment_serial: string | null;
      request_serial: string;
      adjusted_at: string;
      adjusted_by_department: string;
      item_label: string;
      adjustment_remarks: string;
      adjusted_by_name: string;
      adjusted_by_role: string;
      changes: { id: number; field: string; before_value: string | null; after_value: string | null }[];
    }>();
    const order: string[] = [];
    for (const entry of filteredEntries) {
      const key = `${entry.adjustment_serial || `no-serial-${entry.id}`}::${entry.item_label}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          adjustment_serial: entry.adjustment_serial,
          request_serial: entry.request_serial,
          adjusted_at: entry.adjusted_at,
          adjusted_by_department: entry.adjusted_by_department,
          item_label: entry.item_label,
          adjustment_remarks: entry.adjustment_remarks,
          adjusted_by_name: entry.adjusted_by_name,
          adjusted_by_role: entry.adjusted_by_role,
          changes: [],
        };
        groups.set(key, group);
        order.push(key);
      }
      group.changes.push({ id: entry.id, field: entry.field, before_value: entry.before_value, after_value: entry.after_value });
    }
    return order.map((k) => groups.get(k)!);
  }, [filteredEntries]);

  const handleExport = () =>
    exportToExcel(
      "adjustment-history",
      [
        { key: "adjustment_serial", label: "Adjustment No." },
        { key: "request_serial", label: "Serial" },
        { key: "adjusted_at_formatted", label: "Date & Time" },
        { key: "adjusted_by_department", label: "Department" },
        { key: "item_label", label: "Item" },
        { key: "field", label: "Field" },
        { key: "before_value", label: "Before" },
        { key: "after_value", label: "After" },
        { key: "adjustment_remarks", label: "Remarks" },
        { key: "adjusted_by_name", label: "Adjusted By" },
        { key: "adjusted_by_role", label: "Role" },
      ],
      filteredEntries.map((entry) => ({
        adjustment_serial: entry.adjustment_serial || "—",
        request_serial: entry.request_serial,
        adjusted_at_formatted: formatMilitaryDateTime(entry.adjusted_at),
        adjusted_by_department: entry.adjusted_by_department,
        item_label: entry.item_label,
        field: entry.field,
        before_value: entry.before_value || "N/A",
        after_value: entry.after_value || "N/A",
        adjustment_remarks: entry.adjustment_remarks || "—",
        adjusted_by_name: entry.adjusted_by_name,
        adjusted_by_role: entry.adjusted_by_role,
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Adjustment History</h1>
            <p className="dash-subtitle">Every Item Name/Quantity/UoM/Remarks/Machine Code correction ever made</p>
          </div>
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Serial, Item, Field, Before/After, Remarks, Adjusted By..."
          onExport={handleExport}
          exportDisabled={filteredEntries.length === 0}
        />

        <div className="mb-3">
          <DateRangeFilter />
        </div>

        <div className="table-responsive">
          <table className="table table-sm table-hover mb-0 simple-list-table">
            <thead className="table-light">
              <tr>
                <th>Adjustment No.</th>
                <th>Serial</th>
                <th>Date &amp; Time</th>
                <th>Department</th>
                <th>Item</th>
                <th>Field</th>
                <th>Before</th>
                <th>After</th>
                <th>Remarks</th>
                <th>Adjusted By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center text-muted py-3">Loading…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-muted py-3">No adjustments recorded yet.</td></tr>
              ) : groupedEntries.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-muted py-3">No adjustments match your search.</td></tr>
              ) : (
                groupedEntries.map((group) => (
                  <tr key={group.key}>
                    <td data-label="Adjustment No." className="text-nowrap fw-semibold">{group.adjustment_serial || "—"}</td>
                    <td data-label="Serial" className="text-nowrap">{group.request_serial}</td>
                    <td data-label="Date & Time" className="text-muted text-nowrap">{formatMilitaryDateTime(group.adjusted_at)}</td>
                    <td data-label="Department">{group.adjusted_by_department}</td>
                    <td data-label="Item">{group.item_label}</td>
                    <td data-label="Field">
                      {group.changes.map((c) => <div key={c.id}>{c.field}</div>)}
                    </td>
                    <td data-label="Before" className="text-danger">
                      {group.changes.map((c) => <div key={c.id}>{c.before_value || "N/A"}</div>)}
                    </td>
                    <td data-label="After" className="text-success">
                      {group.changes.map((c) => <div key={c.id}>{c.after_value || "N/A"}</div>)}
                    </td>
                    <td data-label="Remarks">{group.adjustment_remarks || <span className="text-muted">—</span>}</td>
                    <td data-label="Adjusted By" className="text-nowrap">
                      {group.adjusted_by_name} <span className="text-muted">({group.adjusted_by_role})</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

export default AdjustmentHistoryPage;
