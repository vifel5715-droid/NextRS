import React, { useCallback, useEffect, useMemo, useState } from "react";
import Layout from "@/components/layout/Layout";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDashboardCounts } from "@/components/providers/DashboardCountsProvider";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import ListToolbar from "@/components/tables/ListToolbar";
import { pettyCashAPI } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { formatDate } from "@/lib/utils/format";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { exportToExcel } from "@/lib/utils/exportExcel";
import AdjustmentHistoryModal from "@/features/reports/components/AdjustmentHistoryModal";
import type { PettyCashTransaction } from "@/types";

type CashPurchaseView = "pending" | "delivered";

const peso = (value: string | number) => `₱${Number(value).toFixed(2)}`;

const thStyle: React.CSSProperties = { padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 };
const thRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const td: React.CSSProperties = { padding: "11px 16px" };

/**
 * Cash Purchase Based on P.O. (the petty_cash ledger), split into two pages:
 *
 * - Pending Cash Purchase (/petty-cash): Item Status Pending. AP Officer
 *   alone adds transactions and edits them — PO Number and Total Amount only
 *   (enforced server-side in updatePettyCashTransactionAction). Custodian
 *   sets Cash Status and Item Status; Item Status Delivered moves the row
 *   over.
 * - Delivered Cash Purchase (/petty-cash/delivered): the server rejects
 *   edits to delivered rows; Custodian can set Item Status back to Pending.
 */
const PettyCashPage: React.FC<{ view?: CashPurchaseView }> = ({ view = "pending" }) => {
  const isDeliveredView = view === "delivered";
  const { user } = useAuth();
  const role = user?.role?.toLowerCase();
  const isAPOfficer = role === "ap_officer" || role === "admin";
  const canConfirmDelivery = role === "custodian" || role === "admin";
  const { cashPurchase } = useDashboardCounts();
  const refreshCounts = cashPurchase.refresh;
  const { startDate, endDate } = useDateRangeContext();

  const [transactions, setTransactions] = useState<PettyCashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadTransactions = useCallback(async () => {
    try {
      const res = await pettyCashAPI.getAll(view);
      setTransactions(res.data);
      setLoadError(null);
    } catch (error: unknown) {
      setLoadError(getErrorMessage(error, "Failed to load cash purchases."));
    } finally {
      setLoading(false);
    }
  }, [view]);

  // Loads on mount, then again whenever the polled badge counts move — so
  // other users' changes (and the other Cash Purchase page's) show up
  // without a reload.
  useEffect(() => {
    void loadTransactions();
  }, [cashPurchase.pending, cashPurchase.delivered, loadTransactions]);

  const afterChange = async () => {
    await loadTransactions();
    refreshCounts();
  };

  // Pending is filtered by when the purchase was recorded, Delivered by when
  // it was delivered.
  const visibleRows = useMemo(() => {
    const inRange = filterByDateRange(transactions, startDate, endDate, isDeliveredView ? "delivered_at" : "created_at");
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inRange;
    return inRange.filter((row) =>
      [row.serial, row.po_number, row.created_by_name, row.receiver_name, row.delivered_by_name].some((field) =>
        (field || "").toLowerCase().includes(q)
      )
    );
  }, [transactions, startDate, endDate, isDeliveredView, searchQuery]);

  const handleExport = () =>
    exportToExcel(
      isDeliveredView ? "delivered-cash-purchase" : "pending-cash-purchase",
      [
        { key: "serial", label: "Series" },
        { key: "po_number", label: "PO Number" },
        { key: "created", label: "Created" },
        { key: "created_by", label: "Recorded By" },
        { key: "total_amount", label: "Total Amount" },
        { key: "cash_received", label: "Cash Received" },
        { key: "cash_received_at", label: "Date Received" },
        { key: "receiver_name", label: "Name of Receiver" },
        { key: "cash_status", label: "Cash Status" },
        { key: "item_status", label: "Item Status" },
        ...(isDeliveredView
          ? [
              { key: "delivered_at" as const, label: "Delivered" },
              { key: "delivered_by" as const, label: "Delivered By" },
            ]
          : []),
      ],
      visibleRows.map((row) => ({
        serial: row.serial,
        po_number: row.po_number,
        created: formatDate(row.created_at),
        created_by: row.created_by_name || "",
        total_amount: Number(row.total_amount).toFixed(2),
        cash_received: row.cash_received != null ? Number(row.cash_received).toFixed(2) : "",
        cash_received_at: row.cash_received_at ? new Date(row.cash_received_at).toLocaleDateString() : "",
        receiver_name: row.receiver_name || "",
        cash_status: row.cash_confirmed_at ? "Received" : "Not Received",
        item_status: row.delivered_at ? "Delivered" : "Pending",
        delivered_at: row.delivered_at ? formatDate(row.delivered_at) : "",
        delivered_by: row.delivered_by_name || "",
      }))
    );

  // New transaction form (Pending page only).
  const [newPoNumber, setNewPoNumber] = useState("");
  const [newTotalAmount, setNewTotalAmount] = useState("");
  const [creating, setCreating] = useState(false);

  const createTransaction = async () => {
    if (!newPoNumber.trim()) {
      alert("Enter a PO Number.");
      return;
    }
    if (!newTotalAmount || Number(newTotalAmount) < 0) {
      alert("Enter a valid Total Amount.");
      return;
    }
    setCreating(true);
    try {
      await pettyCashAPI.create({ po_number: newPoNumber.trim().toUpperCase(), total_amount: Number(newTotalAmount) });
      setNewPoNumber("");
      setNewTotalAmount("");
      await afterChange();
    } catch (error: unknown) {
      alert("Error creating Petty Cash transaction: " + getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  // Adjustment History modal — one transaction's Created/Edited log at a time.
  const [historyId, setHistoryId] = useState<number | null>(null);

  // Inline per-row editor — one row editable at a time (Pending page only).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftPoNumber, setDraftPoNumber] = useState("");
  const [draftTotalAmount, setDraftTotalAmount] = useState("");
  // The row's updated_at when editing began — the server rejects the save
  // if someone else changed the row since.
  const [editingVersion, setEditingVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

  const startEditing = (row: PettyCashTransaction) => {
    setEditingId(row.id);
    setEditingVersion(row.updated_at);
    setDraftPoNumber(row.po_number);
    setDraftTotalAmount(row.total_amount);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingVersion("");
    setDraftPoNumber("");
    setDraftTotalAmount("");
  };

  const editError = !draftPoNumber.trim()
    ? "Enter a PO Number."
    : draftTotalAmount === "" || !(Number(draftTotalAmount) >= 0)
      ? "Enter a valid Total Amount."
      : null;

  // Only PO Number and Total Amount are editable — the server enforces it too.
  const saveEditing = async () => {
    if (!editingId || saving) return;
    if (editError) {
      alert(editError);
      return;
    }
    setSaving(true);
    try {
      await pettyCashAPI.update(editingId, {
        po_number: draftPoNumber.trim().toUpperCase(),
        total_amount: Number(draftTotalAmount),
        expected_updated_at: editingVersion,
      });
      cancelEditing();
      await afterChange();
    } catch (error: unknown) {
      alert("Error saving: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // Custodian's Cash Status / Item Status dropdowns.
  const setCustodianStatus = async (
    row: PettyCashTransaction,
    change: { cash_status?: "received" | "not_received"; item_status?: "delivered" | "pending" }
  ) => {
    if (change.cash_status === "received" &&
      !confirm(`Set ${row.serial} (PO ${row.po_number}) Cash Status to Received? Date Received (today) and Name of Receiver (you) will be filled in, and this can't be changed afterwards.`)) {
      return;
    }
    if (change.item_status === "delivered" &&
      !confirm(`Mark ${row.serial} (PO ${row.po_number}) as Delivered? It will move to Delivered Cash Purchase.`)) {
      return;
    }
    if (change.item_status === "pending" &&
      !confirm(`Set ${row.serial} (PO ${row.po_number}) back to Pending? It will move to Pending Cash Purchase.`)) {
      return;
    }
    setUpdatingStatusId(row.id);
    try {
      await pettyCashAPI.setCustodianStatus(row.id, change);
      await afterChange();
    } catch (error: unknown) {
      alert("Error updating status: " + getErrorMessage(error));
    } finally {
      setUpdatingStatusId(null);
    }
  };

  // Edit + History are AP Officer's; a Custodian works through the status
  // dropdowns instead, so the actions column is dropped for them.
  const showActions = isAPOfficer;
  const columnCount = 10 + (isDeliveredView ? 2 : 0) + (showActions ? 1 : 0);

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">{isDeliveredView ? "Delivered Cash Purchase" : "Pending Cash Purchase"}</h1>
            <p className="dash-subtitle" style={{ color: "#065f46" }}>
              {isDeliveredView
                ? "Cash purchases based on P.O. that have been confirmed as delivered."
                : `Cash purchases based on P.O. awaiting delivery — ${isAPOfficer ? "you can add transactions and edit their PO Number and Total Amount" : "only AP Officer can add and edit transactions"}${canConfirmDelivery ? "; mark each one delivered once its items arrive." : "."}`}
            </p>
          </div>
        </div>

        {!isDeliveredView && isAPOfficer && (
          <div className="row g-2 mb-3 align-items-end">
            <div className="col-12 col-md-4">
              <label className="form-label">PO Number</label>
              <input
                type="text"
                className="form-control text-uppercase"
                value={newPoNumber}
                onChange={(e) => setNewPoNumber(e.target.value)}
                placeholder="PO Number…"
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label">Total Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-control"
                value={newTotalAmount}
                onChange={(e) => setNewTotalAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="col-12 col-md-2">
              <button className="btn btn-primary" disabled={creating} onClick={createTransaction}>
                {creating ? "Adding…" : "Add Transaction"}
              </button>
            </div>
          </div>
        )}

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Series, PO Number, Recorded By, Receiver..."
          onExport={handleExport}
          exportDisabled={visibleRows.length === 0}
        />

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        {loadError && (
          <div className="alert alert-warning d-flex align-items-center gap-2">
            <span>{loadError}</span>
            <button className="btn btn-sm btn-outline-warning" onClick={() => void loadTransactions()}>
              Retry
            </button>
          </div>
        )}

        <div style={{ border: "1px solid #a7f3d0", borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ background: "#d1fae5", borderBottom: "2px solid #a7f3d0" }}>
                  <th style={thStyle}>Series</th>
                  <th style={thStyle}>PO Number</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Recorded By</th>
                  <th style={thRight}>Total Amount</th>
                  <th style={thRight}>Cash Received</th>
                  <th style={thStyle}>Date Received</th>
                  <th style={thStyle}>Name of Receiver</th>
                  <th style={thStyle}>Cash Status</th>
                  <th style={thStyle}>Item Status</th>
                  {isDeliveredView && (
                    <>
                      <th style={thStyle}>Delivered</th>
                      <th style={thStyle}>Delivered By</th>
                    </>
                  )}
                  {showActions && <th style={thStyle}></th>}
                </tr>
              </thead>
              <tbody>
                {loading && transactions.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>Loading...</td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
                      <i className="bi bi-cash-stack" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
                      {transactions.length === 0
                        ? isDeliveredView
                          ? "No delivered cash purchases yet."
                          : "No pending cash purchases."
                        : "No cash purchases match your search or date range."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row, i) => {
                    const isEditing = !isDeliveredView && editingId === row.id;
                    return (
                      <tr key={row.id} style={{ borderBottom: "1px solid #a7f3d0", background: i % 2 === 0 ? "#ecfdf5" : "#fff" }}>
                        <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{row.serial}</td>
                        <td style={td}>
                          {isEditing ? (
                            <input
                              type="text"
                              className="form-control form-control-sm text-uppercase"
                              value={draftPoNumber}
                              onChange={(e) => setDraftPoNumber(e.target.value)}
                            />
                          ) : (
                            row.po_number
                          )}
                        </td>
                        <td style={{ ...td, color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                        <td style={td}>{row.created_by_name || <span className="text-muted">—</span>}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="form-control form-control-sm"
                              style={{ width: "120px", marginLeft: "auto" }}
                              value={draftTotalAmount}
                              onChange={(e) => setDraftTotalAmount(e.target.value)}
                            />
                          ) : (
                            peso(row.total_amount)
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {row.cash_received != null ? peso(row.cash_received) : <span className="text-muted">Not yet recorded</span>}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {row.cash_received_at ? new Date(row.cash_received_at).toLocaleDateString() : <span className="text-muted">—</span>}
                        </td>
                        <td style={td}>{row.receiver_name || <span className="text-muted">—</span>}</td>
                        <td style={td}>
                          {/* Received is final — the dropdown only shows while it's still Not Received. */}
                          {canConfirmDelivery && !row.cash_confirmed_at ? (
                            <select
                              className="form-select form-select-sm"
                              style={{ width: "150px" }}
                              aria-label={`Cash Status for ${row.serial}`}
                              value="not_received"
                              disabled={updatingStatusId === row.id}
                              onChange={(e) =>
                                void setCustodianStatus(row, { cash_status: e.target.value as "received" | "not_received" })
                              }
                            >
                              <option value="not_received">Not Received</option>
                              <option value="received">Received</option>
                            </select>
                          ) : (
                            <span style={{ color: row.cash_confirmed_at ? "#047857" : "#b45309", fontWeight: 600 }}>
                              {row.cash_confirmed_at ? "Received" : "Not Received"}
                            </span>
                          )}
                        </td>
                        <td style={td}>
                          {canConfirmDelivery ? (
                            <select
                              className="form-select form-select-sm"
                              style={{ width: "130px" }}
                              aria-label={`Item Status for ${row.serial}`}
                              value={row.delivered_at ? "delivered" : "pending"}
                              disabled={updatingStatusId === row.id || (!row.delivered_at && !row.cash_confirmed_at)}
                              title={!row.delivered_at && !row.cash_confirmed_at ? "Set Cash Status to Received first" : undefined}
                              onChange={(e) =>
                                void setCustodianStatus(row, { item_status: e.target.value as "delivered" | "pending" })
                              }
                            >
                              <option value="pending">Pending</option>
                              <option value="delivered">Delivered</option>
                            </select>
                          ) : (
                            <span style={{ color: row.delivered_at ? "#1d4ed8" : "#b45309", fontWeight: 600 }}>
                              {row.delivered_at ? "Delivered" : "Pending"}
                            </span>
                          )}
                        </td>
                        {isDeliveredView && (
                          <>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{row.delivered_at ? formatDate(row.delivered_at) : "—"}</td>
                            <td style={td}>{row.delivered_by_name || <span className="text-muted">—</span>}</td>
                          </>
                        )}
                        {showActions && (
                        <td style={td}>
                          {isEditing ? (
                            <div className="d-flex gap-2 flex-wrap">
                              <button
                                className="btn btn-sm btn-success"
                                disabled={saving || editError !== null}
                                title={editError ?? undefined}
                                onClick={() => void saveEditing()}
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button className="btn btn-sm btn-outline-secondary" disabled={saving} onClick={cancelEditing}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="d-flex gap-2 align-items-center flex-wrap">
                              {!isDeliveredView && isAPOfficer && (
                                <button className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => startEditing(row)}>
                                  Edit
                                </button>
                              )}
                              <button className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => setHistoryId(row.id)}>
                                History
                              </button>
                            </div>
                          )}
                        </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AdjustmentHistoryModal
        isOpen={historyId !== null}
        onClose={() => setHistoryId(null)}
        requestId={historyId}
        requestType="petty_cash"
      />
    </Layout>
  );
};

export default PettyCashPage;
