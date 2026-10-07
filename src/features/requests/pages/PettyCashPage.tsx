import React, { useEffect, useState } from "react";
import Layout from "@shared/components/Layout";
import { useAuth } from "@app/providers/AuthProvider";
import { pettyCashAPI } from "../../../services/api";
import { getErrorMessage } from "@shared/utils/errorMessage";
import { formatDate } from "@shared/utils/format";
import AdjustmentHistoryModal from "@features/adjustments/components/AdjustmentHistoryModal";
import type { PettyCashTransaction } from "@shared/types";

/**
 * Petty Cash — a simple, independent ledger (no request/approval chain at
 * all, unlike every other page in this app). Custodian and AP Officer both
 * create transactions and can edit PO Number/Total Amount; Cash Received is
 * AP Officer's alone to record — enforced server-side (petty-cash.service.ts's
 * updatePettyCash), gated here client-side too so Custodian never sees an
 * editable field they'd just get a 403 from. Name of Receiver is restricted
 * to the Custodian name list (petty-cash.service.ts's getCustodianNames) —
 * a plain <select>, not a free-typed combobox, since a typed name that isn't
 * a registered Custodian is rejected server-side anyway. Date Received has
 * no input at all — a manually-typed date produced garbled values (e.g.
 * "12/31/1"), so updatePettyCash now sets it automatically to today
 * whenever Cash Received is recorded.
 */
const PettyCashPage: React.FC = () => {
  const { user } = useAuth();
  const isAPOfficer = user?.role?.toLowerCase() === "ap_officer" || user?.role?.toLowerCase() === "admin";

  const [transactions, setTransactions] = useState<PettyCashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [custodianNames, setCustodianNames] = useState<string[]>([]);

  const loadTransactions = async () => {
    try {
      const res = await pettyCashAPI.getAll();
      setTransactions(res.data);
    } catch (error: unknown) {
      alert("Error loading Petty Cash transactions: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTransactions();
  }, []);

  useEffect(() => {
    if (!isAPOfficer) return;
    pettyCashAPI.getCustodianNames().then((res) => setCustodianNames(res.data)).catch(() => {
      // silently ignore — the dropdown just stays empty without it
    });
  }, [isAPOfficer]);

  // New transaction form.
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
      await loadTransactions();
    } catch (error: unknown) {
      alert("Error creating Petty Cash transaction: " + getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  // Adjustment History modal — one transaction's Created/Edited log at a time.
  const [historyId, setHistoryId] = useState<number | null>(null);

  // Inline per-row editor — one row editable at a time.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftPoNumber, setDraftPoNumber] = useState("");
  const [draftTotalAmount, setDraftTotalAmount] = useState("");
  const [draftCashReceived, setDraftCashReceived] = useState("");
  const [draftReceiverName, setDraftReceiverName] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = (row: PettyCashTransaction) => {
    setEditingId(row.id);
    setDraftPoNumber(row.po_number);
    setDraftTotalAmount(row.total_amount);
    setDraftCashReceived(row.cash_received ?? "");
    setDraftReceiverName(row.receiver_name ?? "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraftPoNumber("");
    setDraftTotalAmount("");
    setDraftCashReceived("");
    setDraftReceiverName("");
  };

  const saveEditing = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await pettyCashAPI.update(editingId, {
        po_number: draftPoNumber.trim().toUpperCase(),
        total_amount: Number(draftTotalAmount),
        ...(isAPOfficer ? {
          cash_received: draftCashReceived === "" ? undefined : Number(draftCashReceived),
          receiver_name: draftReceiverName.trim() === "" ? undefined : draftReceiverName.trim().toUpperCase(),
        } : {}),
      });
      cancelEditing();
      await loadTransactions();
    } catch (error: unknown) {
      alert("Error saving Petty Cash transaction: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Petty Cash</h1>
            <p className="dash-subtitle" style={{ color: "#065f46" }}>
              PO Number, Total Amount, and Cash Received — {isAPOfficer ? "you can record Cash Received here." : "only AP Officer can record Cash Received."}
            </p>
          </div>
        </div>

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

        <div style={{ border: "1px solid #a7f3d0", borderRadius: "10px", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>Loading...</div>
          ) : transactions.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#9ca3af" }}>
              <i className="bi bi-cash-stack" style={{ fontSize: "2.5rem", display: "block", marginBottom: "12px" }}></i>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>No Petty Cash transactions yet.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="simple-list-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#d1fae5", borderBottom: "2px solid #a7f3d0" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Series</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>PO Number</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Created</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Created By</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", color: "#065f46", fontWeight: 600 }}>Total Amount</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", color: "#065f46", fontWeight: 600 }}>Cash Received</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Date Received</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Name of Receiver</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#065f46", fontWeight: 600 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row, i) => {
                    const isEditing = editingId === row.id;
                    return (
                      <tr key={row.id} style={{ borderBottom: "1px solid #a7f3d0", background: i % 2 === 0 ? "#ecfdf5" : "#fff" }}>
                        <td style={{ padding: "11px 16px", fontWeight: 600, whiteSpace: "nowrap" }}>{row.serial}</td>
                        <td style={{ padding: "11px 16px" }}>
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
                        <td style={{ padding: "11px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                        <td style={{ padding: "11px 16px" }}>{row.created_by_name || <span className="text-muted">—</span>}</td>
                        <td style={{ padding: "11px 16px", textAlign: "right" }}>
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
                            `₱${Number(row.total_amount).toFixed(2)}`
                          )}
                        </td>
                        <td style={{ padding: "11px 16px", textAlign: "right" }}>
                          {isEditing && isAPOfficer ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="form-control form-control-sm"
                              style={{ width: "120px", marginLeft: "auto" }}
                              value={draftCashReceived}
                              onChange={(e) => setDraftCashReceived(e.target.value)}
                              placeholder="0.00"
                            />
                          ) : row.cash_received != null ? (
                            `₱${Number(row.cash_received).toFixed(2)}`
                          ) : (
                            <span className="text-muted">Not yet recorded</span>
                          )}
                        </td>
                        <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                          {row.cash_received_at ? (
                            new Date(row.cash_received_at).toLocaleDateString()
                          ) : isEditing && isAPOfficer ? (
                            <span className="text-muted">Set to today on Save</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td style={{ padding: "11px 16px" }}>
                          {isEditing && isAPOfficer ? (
                            <select
                              className="form-select form-select-sm"
                              style={{ width: "200px" }}
                              value={draftReceiverName}
                              onChange={(e) => setDraftReceiverName(e.target.value)}
                            >
                              <option value="">— Select Custodian —</option>
                              {custodianNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          ) : row.receiver_name ? (
                            row.receiver_name
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td style={{ padding: "11px 16px" }}>
                          {row.cash_received != null ? (
                            <span style={{ color: "#047857", fontWeight: 600 }}>Received</span>
                          ) : (
                            <span style={{ color: "#b45309", fontWeight: 600 }}>Pending</span>
                          )}
                        </td>
                        <td style={{ padding: "11px 16px" }}>
                          {isEditing ? (
                            <div className="d-flex gap-2">
                              <button className="btn btn-sm btn-success" disabled={saving} onClick={saveEditing}>
                                Save
                              </button>
                              <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditing}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="d-flex gap-2">
                              <button className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => startEditing(row)}>
                                Edit
                              </button>
                              <button className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => setHistoryId(row.id)}>
                                History
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
