import React, { useMemo, useState } from "react";
import { usePurchasePaymentItems } from "@/features/purchase-requests/hooks/usePurchasePaymentItems";
import { useAuth } from "@/components/providers/AuthProvider";
import Layout from "@/components/layout/Layout";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import Modal from "@/components/dialogs/Modal";
import PaymentRequestFormFields, { type FormFields } from "@/features/requests/components/PaymentRequestFormFields";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { formatDate } from "@/lib/utils/format";
import { itemRequestAPI } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import type { ItemPaymentRequestForm } from "@/types";

const DELIVERED_STATUSES = ["DELIVERED", "PARTIAL DELIVERED"];

/** Item status badge rules, narrowed to
 * this page's rows, which are always pr_type "URGENT". */
const urgentItemStatusBadge = (status: string, isActive: boolean) => {
  if (isActive) return { label: "PENDING", bg: "#fee2e2", color: "#991b1b" };
  if (status === "DELIVERED") return { label: "DELIVERED", bg: "#d1fae5", color: "#065f46" };
  if (status === "PARTIAL DELIVERED") return { label: "PARTIAL DELIVERED", bg: "#fef3c7", color: "#92400e" };
  return { label: status || "INACTIVE", bg: "#e5e7eb", color: "#4b5563" };
};

/**
 * "Urgent Item From IRS" — a dedicated view of Item Request System (IRS)
 * items flagged pr_type "URGENT" (renamed from the old "PAYMENT REQUEST"
 * classification — see rename-payment-request-to-urgent.ts), pulled out of
 * the old mixed Purchase/Urgent items tab into its own
 * sidebar page for Custodian and Purchaser. Not to be confused with the
 * separate Urgent Request workflow (urgent_requests table, its own
 * Supervisor/Stockroom approval chain) — this page covers regular Item
 * Requests whose item was classified Urgent, active or already resolved.
 */
const UrgentItemsPage: React.FC = () => {
  const { user } = useAuth();
  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;
  // "Submitted Payment Request" — whoever can reach the AP Officer Dashboard
  // (AP Officer, Operations Manager, admin) can still edit this form past
  // submission; Purchaser/Custodian can only view it read-only from here on
  // (see PaymentRequestFormFields.tsx's canEditAfterSubmit).
  const canEditPaymentRequestFormAfterSubmit = hasPermission("ap_officer_dashboard");
  const { startDate, endDate } = useDateRangeContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");

  const purchasePaymentItems = usePurchasePaymentItems(!!user);

  // Inline per-item Transaction Type editor — one row editable at a time,
  // same pattern as PurchaserDashboard.tsx's urgent-request-item editor.
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [draftTransaction, setDraftTransaction] = useState<"" | "purchase_order" | "payment_request">("");
  const [draftAmount, setDraftAmount] = useState("");
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      purchasePaymentItems.flatMap((req) =>
        req.items
          .filter((item) => item.pr_type === "URGENT")
          .map((item, i) => ({
            key: `${req.id}-${i}`,
            id: item.id,
            request_id: req.id,
            item_name: item.item_name,
            serial: req.serial,
            date_needed: item.date_needed || "",
            qty: item.qty_balance,
            purpose: req.purpose,
            status: item.delivery_status || "",
            is_active: item.is_active,
            machine_code: item.machine_code || "",
            purchasing_transaction: item.purchasing_transaction,
            amount: item.amount,
            is_inventoriable: item.is_inventoriable,
            created_at: req.created_at,
          })),
      ),
    [purchasePaymentItems]
  );

  const startEditingItem = (row: { id: number; purchasing_transaction: string | null; amount: string | null }) => {
    setEditingItemId(row.id);
    setDraftTransaction((row.purchasing_transaction as "purchase_order" | "payment_request" | null) || "");
    setDraftAmount(row.amount || "");
  };

  const cancelEditingItem = () => {
    setEditingItemId(null);
    setDraftTransaction("");
    setDraftAmount("");
  };

  const saveEditingItem = async () => {
    if (!editingItemId || !draftTransaction) return;
    if (draftTransaction === "payment_request" && (!draftAmount || Number(draftAmount) < 0)) {
      alert("Enter a valid amount for a Payment Request item.");
      return;
    }
    setSavingItemId(editingItemId);
    try {
      await itemRequestAPI.setItemPurchasingTransaction(editingItemId, {
        purchasing_transaction: draftTransaction,
        amount: draftTransaction === "payment_request" ? Number(draftAmount) : undefined,
      });
      cancelEditingItem();
    } catch (error: unknown) {
      alert("Error saving transaction type: " + getErrorMessage(error));
    } finally {
      setSavingItemId(null);
    }
  };

  // Inventoriable toggle — real trackable stock vs a one-off consumable.
  // Feeds the "Pending Item Entry" page (Payment Request + Inventoriable).
  const [savingInventoriableId, setSavingInventoriableId] = useState<number | null>(null);

  const toggleInventoriable = async (row: { id: number; is_inventoriable: boolean }) => {
    setSavingInventoriableId(row.id);
    try {
      await itemRequestAPI.setItemInventoriable(row.id, { is_inventoriable: !row.is_inventoriable });
    } catch (error: unknown) {
      alert("Error saving Inventoriable status: " + getErrorMessage(error));
    } finally {
      setSavingInventoriableId(null);
    }
  };

  // Payment Request Form (F-ACC-003) — one per Item Request, aggregating
  // every item on that request classified payment_request. Same pattern as
  // useUrgentRequests.ts's version for the separate Urgent Request workflow.
  const [paymentRequestFormRequestId, setPaymentRequestFormRequestId] = useState<number | null>(null);
  const [paymentRequestForm, setPaymentRequestForm] = useState<ItemPaymentRequestForm | null>(null);
  const [loadingPaymentRequestForm, setLoadingPaymentRequestForm] = useState(false);
  const [savingPaymentRequestForm, setSavingPaymentRequestForm] = useState(false);

  const openPaymentRequestForm = async (requestId: number) => {
    setPaymentRequestFormRequestId(requestId);
    setPaymentRequestForm(null);
    setLoadingPaymentRequestForm(true);
    try {
      const res = await itemRequestAPI.getPaymentRequestForm(requestId);
      setPaymentRequestForm(res.data);
    } catch (error: unknown) {
      alert("Error loading Payment Request Form: " + getErrorMessage(error));
      setPaymentRequestFormRequestId(null);
    } finally {
      setLoadingPaymentRequestForm(false);
    }
  };

  const closePaymentRequestForm = () => {
    setPaymentRequestFormRequestId(null);
    setPaymentRequestForm(null);
  };

  const savePaymentRequestFormFields = async (requestId: number, fields: FormFields) => {
    setSavingPaymentRequestForm(true);
    try {
      const res = await itemRequestAPI.savePaymentRequestForm(requestId, {
        ...fields,
        total_amount_due: fields.total_amount_due !== "" ? Number(fields.total_amount_due) : undefined,
      });
      setPaymentRequestForm(res.data);
    } catch (error: unknown) {
      alert("Error saving Payment Request Form: " + getErrorMessage(error));
    } finally {
      setSavingPaymentRequestForm(false);
    }
  };

  // "Submitted Payment Request" — one-way submit action, locking the form to
  // AP Officer edits from here on. Mirrors useUrgentRequests.ts's version.
  const [submittingPaymentRequestForm, setSubmittingPaymentRequestForm] = useState(false);

  const submitPaymentRequestForm = async (requestId: number) => {
    setSubmittingPaymentRequestForm(true);
    try {
      const res = await itemRequestAPI.submitPaymentRequestForm(requestId);
      setPaymentRequestForm(res.data);
    } catch (error: unknown) {
      alert("Error submitting Payment Request Form: " + getErrorMessage(error));
    } finally {
      setSubmittingPaymentRequestForm(false);
    }
  };

  const rowsInRange = useMemo(
    () => filterByDateRange(rows, startDate, endDate, "created_at"),
    [rows, startDate, endDate]
  );

  const activeCount = useMemo(() => rowsInRange.filter((row) => row.is_active).length, [rowsInRange]);
  const inactiveCount = useMemo(() => rowsInRange.filter((row) => !row.is_active).length, [rowsInRange]);

  const filteredRows = useMemo(() => {
    let filtered = rowsInRange;
    if (activeFilter !== "all") filtered = filtered.filter((row) => row.is_active === (activeFilter === "active"));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((row) =>
      row.item_name.toLowerCase().includes(q) ||
      row.serial.toLowerCase().includes(q) ||
      row.purpose.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q) ||
      row.machine_code.toLowerCase().includes(q)
    );
  }, [rowsInRange, activeFilter, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      "urgent-items-irs",
      [
        { key: "item_name", label: "Item Name" },
        { key: "date_needed", label: "Date Needed" },
        { key: "created_at", label: "Date Created" },
        { key: "serial", label: "Serial" },
        { key: "qty", label: "Qty" },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
        { key: "transaction_type_label", label: "Transaction Type" },
        { key: "inventoriable_label", label: "Inventoriable" },
        { key: "status", label: "Status" },
        { key: "active_label", label: "Active?" },
      ],
      filteredRows.map((row) => ({
        ...row,
        date_needed: row.date_needed ? new Date(row.date_needed).toLocaleDateString() : "N/A",
        created_at: formatDate(row.created_at),
        transaction_type_label:
          row.purchasing_transaction === "payment_request" ? `Payment Request (₱${Number(row.amount || 0).toFixed(2)})`
          : row.purchasing_transaction === "purchase_order" ? "Purchase Order"
          : "Not Classified",
        inventoriable_label: row.is_inventoriable ? "Yes" : "No",
        active_label: row.is_active ? "ACTIVE" : DELIVERED_STATUSES.includes(row.status) ? "DELIVERED · INACTIVE" : "INACTIVE",
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Urgent Item From IRS</h1>
            <p className="dash-subtitle" style={{ color: "#991b1b" }}>
              Item Request System items flagged Urgent — including ones already delivered or released
            </p>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {([
            { key: "all" as const, label: "All Urgent Items", count: rowsInRange.length },
            { key: "active" as const, label: "Active — still awaiting action", count: activeCount },
            { key: "inactive" as const, label: "Inactive — delivered or released", count: inactiveCount },
          ]).map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => setActiveFilter(tile.key)}
              style={{
                flex: "1 1 200px",
                minWidth: "160px",
                textAlign: "left",
                background: "#fee2e2",
                border: `2px solid ${activeFilter === tile.key ? "#991b1b" : "#fecaca"}`,
                borderRadius: "10px",
                padding: "10px 14px",
                cursor: "pointer",
                boxShadow: activeFilter === tile.key ? "0 2px 6px rgba(0,0,0,0.12)" : "none",
              }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#991b1b", lineHeight: 1.2 }}>{tile.count}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#991b1b", opacity: 0.85 }}>{tile.label}</div>
            </button>
          ))}
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item Name, Serial, Purpose, Machine Code, or Status..."
          onExport={handleExport}
          exportDisabled={filteredRows.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        <div style={{ border: "1px solid #fca5a5", borderRadius: "10px", overflow: "hidden" }}>
          {rowsInRange.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-exclamation-triangle" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No urgent items found.</p>
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
                  <tr style={{ background: "#fee2e2", borderBottom: "2px solid #fca5a5" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Item Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Date Needed</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Date Created</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Purpose</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Machine Code</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Transaction Type</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Inventoriable</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Payment Request Form</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#991b1b", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => {
                    const isEditing = editingItemId === row.id;
                    return (
                    <tr
                      key={row.key}
                      style={{ borderBottom: "1px solid #fca5a5", background: i % 2 === 0 ? "#fff5f5" : "#fff" }}
                    >
                      <td data-label="Item Name" style={{ padding: "11px 16px", fontWeight: 500 }}>{row.item_name}</td>
                      <td data-label="Date Needed" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date_needed ? new Date(row.date_needed).toLocaleDateString() : "—"}</td>
                      <td data-label="Date Created" style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                      <td data-label="Serial" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.serial}</td>
                      <td data-label="Qty" style={{ padding: "11px 16px", fontWeight: 600, color: "#92400e" }}>{row.qty}</td>
                      <td data-label="Purpose" style={{ padding: "11px 16px", color: "#6b7280" }}>{row.purpose}</td>
                      <td data-label="Machine Code" style={{ padding: "11px 16px", fontFamily: "monospace", color: "#374151" }}>{row.machine_code || "—"}</td>
                      <td data-label="Transaction Type" style={{ padding: "11px 16px" }}>
                        {isEditing ? (
                          <div className="d-flex flex-wrap gap-2 align-items-center">
                            <select
                              className="form-select form-select-sm"
                              style={{ width: "160px" }}
                              value={draftTransaction}
                              onChange={(e) => setDraftTransaction(e.target.value as "purchase_order" | "payment_request")}
                            >
                              <option value="">Select...</option>
                              <option value="purchase_order">Purchase Order</option>
                              <option value="payment_request">Payment Request</option>
                            </select>
                            {draftTransaction === "payment_request" && (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="form-control form-control-sm"
                                style={{ width: "110px" }}
                                placeholder="Amount"
                                value={draftAmount}
                                onChange={(e) => setDraftAmount(e.target.value)}
                              />
                            )}
                            <button
                              className="btn btn-sm btn-success"
                              disabled={savingItemId === row.id}
                              onClick={saveEditingItem}
                            >
                              Save
                            </button>
                            <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditingItem}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="d-flex align-items-center gap-2">
                            {row.purchasing_transaction === "payment_request" ? (
                              <span
                                className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 fw-semibold"
                                style={{ backgroundColor: "#f3e8ff", color: "#7c3aed", fontSize: "0.78rem" }}
                              >
                                <i className="bi bi-cash-coin"></i>
                                Payment Request
                                {row.amount && (
                                  <span className="fw-bold" style={{ color: "#5b21b6" }}>
                                    ₱{Number(row.amount).toFixed(2)}
                                  </span>
                                )}
                              </span>
                            ) : row.purchasing_transaction === "purchase_order" ? (
                              <span
                                className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 fw-semibold"
                                style={{ backgroundColor: "#dbeafe", color: "#1d4ed8", fontSize: "0.78rem" }}
                              >
                                <i className="bi bi-cart-check"></i>
                                Purchase Order
                              </span>
                            ) : (
                              <span
                                className="d-inline-flex align-items-center gap-1 rounded-pill px-3 py-1 text-muted"
                                style={{ backgroundColor: "#f1f5f9", fontSize: "0.78rem" }}
                              >
                                <i className="bi bi-dash-circle"></i>
                                Not Classified
                              </span>
                            )}
                            <button
                              className="btn btn-sm btn-link text-decoration-none p-0"
                              style={{ fontSize: "0.8rem" }}
                              onClick={() => startEditingItem(row)}
                            >
                              {row.purchasing_transaction ? "Change" : "Set"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td data-label="Inventoriable" style={{ padding: "11px 16px" }}>
                        <button
                          className={`btn btn-sm ${row.is_inventoriable ? "btn-success" : "btn-outline-secondary"}`}
                          disabled={savingInventoriableId === row.id}
                          onClick={() => toggleInventoriable(row)}
                          title="Click to toggle"
                        >
                          {row.is_inventoriable ? "Yes" : "No"}
                        </button>
                      </td>
                      <td data-label="Payment Request Form" style={{ padding: "11px 16px" }}>
                        {row.purchasing_transaction === "payment_request" ? (
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => openPaymentRequestForm(row.request_id)}
                          >
                            <i className="bi bi-file-earmark-text me-1"></i>View
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td data-label="Status" style={{ padding: "11px 16px" }}>
                        {(() => {
                          const badge = urgentItemStatusBadge(row.status, row.is_active);
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={paymentRequestFormRequestId !== null}
        onClose={closePaymentRequestForm}
        title="Payment Request — F-ACC-003"
      >
        {loadingPaymentRequestForm || !paymentRequestForm ? (
          <div className="p-3 text-muted">Loading...</div>
        ) : (
          <PaymentRequestFormFields
            key={paymentRequestForm.item_request_id}
            form={paymentRequestForm}
            requestSerial={rows.find((r) => r.request_id === paymentRequestFormRequestId)?.serial ?? ""}
            saving={savingPaymentRequestForm}
            submitting={submittingPaymentRequestForm}
            canEditAfterSubmit={canEditPaymentRequestFormAfterSubmit}
            onClose={closePaymentRequestForm}
            onSave={(fields) => {
              if (paymentRequestFormRequestId !== null) savePaymentRequestFormFields(paymentRequestFormRequestId, fields);
            }}
            onSubmit={() => {
              if (paymentRequestFormRequestId !== null) submitPaymentRequestForm(paymentRequestFormRequestId);
            }}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default UrgentItemsPage;
