import React, { useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import Layout from "@/components/layout/Layout";
import Modal from "@/components/dialogs/Modal";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { formatMilitaryDateTime } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { useSubmittedPaymentRequests } from "@/features/purchase-requests/hooks/useSubmittedPaymentRequests";
import PaymentRequestFormFields, { type FormFields } from "@/features/requests/components/PaymentRequestFormFields";
import { urgentRequestAPI, itemRequestAPI } from "@/lib/api";
import type { PaymentRequestForm, ItemPaymentRequestForm, SubmittedPaymentRequest } from "@/types";

const SOURCE_LABELS: Record<SubmittedPaymentRequest["source"], string> = {
  urgent: "Urgent Request",
  item: "Item Request (IRS)",
};

/**
 * "Submitted Payment Request" — every F-ACC-003 Payment Request Form the
 * Purchaser (or, for the IRS workflow, Custodian) has submitted, from both
 * sources (see useSubmittedPaymentRequests.ts). Purchaser sees this
 * read-only from here on; AP Officer (and Operations Manager/admin, via the
 * same ap_officer_dashboard Edit grant) can still open a row and edit it —
 * see PaymentRequestFormFields.tsx's canEditAfterSubmit.
 */
const SubmittedPaymentRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;
  const canEdit = hasPermission("ap_officer_dashboard");

  const { requests, loading, reload } = useSubmittedPaymentRequests();
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");

  const requestsInRange = useMemo(
    () => filterByDateRange(requests, startDate, endDate, "submitted_at"),
    [requests, startDate, endDate]
  );

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return requestsInRange;
    return requestsInRange.filter((row) =>
      row.serial.toLowerCase().includes(q) ||
      (row.department || "").toLowerCase().includes(q) ||
      (row.payee || "").toLowerCase().includes(q) ||
      (row.submitted_by_name || "").toLowerCase().includes(q)
    );
  }, [requestsInRange, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      "submitted-payment-requests",
      [
        { key: "source_label", label: "Type" },
        { key: "serial", label: "Serial" },
        { key: "department", label: "Department" },
        { key: "payee", label: "Payee" },
        { key: "total_amount_due", label: "Total Amount" },
        { key: "submitted_by_name", label: "Submitted By" },
        { key: "submitted_at", label: "Submitted At" },
      ],
      filteredRequests.map((row) => ({
        source_label: SOURCE_LABELS[row.source],
        serial: row.serial,
        department: row.department || "",
        payee: row.payee || "",
        total_amount_due: row.total_amount_due ? Number(row.total_amount_due).toFixed(2) : "0.00",
        submitted_by_name: row.submitted_by_name || "",
        submitted_at: row.submitted_at ? formatMilitaryDateTime(row.submitted_at) : "",
      }))
    );

  // Payment Request Form modal — loads the real form (with its Particulars
  // table) for whichever row was clicked, keyed by source since the two
  // workflows are separate API resources (see shared/types's
  // PaymentRequestForm/ItemPaymentRequestForm).
  const [openRow, setOpenRow] = useState<SubmittedPaymentRequest | null>(null);
  const [form, setForm] = useState<PaymentRequestForm | ItemPaymentRequestForm | null>(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const openForm = async (row: SubmittedPaymentRequest) => {
    setOpenRow(row);
    setForm(null);
    setLoadingForm(true);
    try {
      const res = row.source === "urgent"
        ? await urgentRequestAPI.getPaymentRequestForm(row.request_id)
        : await itemRequestAPI.getPaymentRequestForm(row.request_id);
      setForm(res.data);
    } catch (error: unknown) {
      alert("Error loading Payment Request Form: " + getErrorMessage(error));
      setOpenRow(null);
    } finally {
      setLoadingForm(false);
    }
  };

  const closeForm = () => {
    setOpenRow(null);
    setForm(null);
  };

  const saveForm = async (fields: FormFields) => {
    if (!openRow) return;
    setSaving(true);
    try {
      const data = { ...fields, total_amount_due: fields.total_amount_due !== "" ? Number(fields.total_amount_due) : undefined };
      const res = openRow.source === "urgent"
        ? await urgentRequestAPI.savePaymentRequestForm(openRow.request_id, data)
        : await itemRequestAPI.savePaymentRequestForm(openRow.request_id, data);
      setForm(res.data);
      void reload();
    } catch (error: unknown) {
      alert("Error saving Payment Request Form: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Submitted Payment Request</h1>
        <p className="page-subtitle">
          {canEdit ? "Every submitted F-ACC-003 form — open one to edit it." : "Every Payment Request Form you've submitted — read only from here on."}
        </p>
      </div>

      <ListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by Serial, Department, Payee, or Submitted By..."
        onExport={handleExport}
        exportDisabled={filteredRequests.length === 0}
      />
      <div className="mb-4">
        <DateRangeFilter />
      </div>

      <div style={{ border: "1px solid #c4b5fd", borderRadius: "10px", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>Loading...</div>
        ) : requestsInRange.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
            <i className="bi bi-file-earmark-text" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>No submitted Payment Request Forms yet.</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
            <i className="bi bi-search" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>No requests match your search and filters.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ background: "#ede9fe", borderBottom: "2px solid #c4b5fd" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Type</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Serial</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Department</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Payee</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", color: "#5b21b6", fontWeight: 600 }}>Total Amount</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Submitted By</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}>Submitted At</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#5b21b6", fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((row, i) => (
                  <tr
                    key={`${row.source}-${row.request_id}`}
                    style={{ borderBottom: "1px solid #ddd6fe", background: i % 2 === 0 ? "#faf5ff" : "#fff" }}
                  >
                    <td data-label="Type" style={{ padding: "11px 16px" }}>
                      <span
                        className="d-inline-flex align-items-center rounded-pill px-3 py-1 fw-semibold"
                        style={{
                          backgroundColor: row.source === "urgent" ? "#dbeafe" : "#fee2e2",
                          color: row.source === "urgent" ? "#1d4ed8" : "#991b1b",
                          fontSize: "0.75rem",
                        }}
                      >
                        {SOURCE_LABELS[row.source]}
                      </span>
                    </td>
                    <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                    <td data-label="Department" style={{ padding: "11px 16px" }}>{row.department || "—"}</td>
                    <td data-label="Payee" style={{ padding: "11px 16px" }}>{row.payee || "—"}</td>
                    <td data-label="Total Amount" style={{ padding: "11px 16px", textAlign: "right", fontWeight: 600 }}>
                      ₱{Number(row.total_amount_due || 0).toFixed(2)}
                    </td>
                    <td data-label="Submitted By" style={{ padding: "11px 16px" }}>{row.submitted_by_name || "—"}</td>
                    <td data-label="Submitted At" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>
                      {row.submitted_at ? formatMilitaryDateTime(row.submitted_at) : "—"}
                    </td>
                    <td data-label="" style={{ padding: "11px 16px" }}>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openForm(row)}>
                        <i className={`bi ${canEdit ? "bi-pencil-square" : "bi-eye"} me-1`}></i>
                        {canEdit ? "Edit" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={openRow !== null} onClose={closeForm} title="Payment Request — F-ACC-003">
        {loadingForm || !form ? (
          <div className="p-3 text-muted">Loading...</div>
        ) : (
          <PaymentRequestFormFields
            key={`${openRow?.source}-${openRow?.request_id}`}
            form={form}
            requestSerial={openRow?.serial ?? ""}
            saving={saving}
            canEditAfterSubmit={canEdit}
            onClose={closeForm}
            onSave={saveForm}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default SubmittedPaymentRequestsPage;
