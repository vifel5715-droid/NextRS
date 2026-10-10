import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@app/providers/AuthProvider";
import { urgentRequestAPI } from "../../../services/api";
import { getUrgentRequestsAction } from "@server/actions/special-requests";
import { reviewSupervisorRequestAction } from "@server/actions/supervisor-review";
import { createLogger } from "@shared/utils/logger";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { getErrorMessage } from "@shared/utils/errorMessage";
import type { UrgentRequest, UrgentRequestItem, PaymentRequestForm } from "@shared/types";

const log = createLogger("useUrgentRequests");

const emptyUrgentItem: UrgentRequestItem = { item_description: "", quantity: undefined, uom: "", is_inventoriable: false };

/**
 * Owns the Urgent Request workflow, Phase 1 (see the Urgent Request plan) —
 * kept as its own hook rather than folded into useStaffRequests.ts/
 * useCustodianRequests.ts, since those already own a lot of state and this
 * is a genuinely separate, additive feature (own tables, own list, own
 * review step) that both StaffDashboard.tsx (create side) and
 * CustodianDashboard.tsx (Stockroom review side) pull in independently.
 */
export function useUrgentRequests() {
  const { user } = useAuth();

  // ---- Create form (requester side) ----
  const [urgentFormData, setUrgentFormData] = useState({ department: "", requested_by: "", purpose: "", remarks: "", date_needed: "" });
  const [urgentItems, setUrgentItems] = useState<UrgentRequestItem[]>([{ ...emptyUrgentItem }]);
  const [isSubmittingUrgent, setIsSubmittingUrgent] = useState(false);

  const resetUrgentForm = useCallback(() => {
    setUrgentFormData({ department: user?.department || "", requested_by: user?.name || "", purpose: "", remarks: "", date_needed: "" });
    setUrgentItems([{ ...emptyUrgentItem }]);
  }, [user?.department, user?.name]);

  // Defaults Requested By to whoever is logged in — same as
  // useStaffRequests.ts's item/service Create form. Without this it stayed
  // permanently blank (never set anywhere else) for every non-Secretary
  // role, since Secretary alone types it manually via itemRequesterName.
  useEffect(() => {
    setUrgentFormData((f) => ({ ...f, department: user?.department || f.department, requested_by: f.requested_by || user?.name || "" }));
  }, [user?.department, user?.name]);

  const addUrgentItemRow = () => setUrgentItems((prev) => [...prev, { ...emptyUrgentItem }]);

  const removeUrgentItemRow = (index: number) => {
    if (urgentItems.length > 1) setUrgentItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateUrgentItemRow = (index: number, field: keyof UrgentRequestItem, value: string | number | boolean | undefined) =>
    setUrgentItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });

  const submitUrgentRequest = useCallback(async (): Promise<boolean> => {
    if (!urgentFormData.department) {
      alert("Please select a department.");
      return false;
    }
    if (!urgentFormData.purpose.trim()) {
      alert("Purpose is required.");
      return false;
    }
    const items = urgentItems.filter((i) => i.item_description.trim());
    if (items.length === 0) {
      alert("Enter at least one item.");
      return false;
    }

    setIsSubmittingUrgent(true);
    try {
      log.info("Submitting urgent request — department:", urgentFormData.department, "items:", items.length);
      await urgentRequestAPI.create({
        department: urgentFormData.department,
        requested_by: urgentFormData.requested_by || undefined,
        purpose: urgentFormData.purpose.toUpperCase(),
        remarks: urgentFormData.remarks ? urgentFormData.remarks.toUpperCase() : undefined,
        date_needed: urgentFormData.date_needed || undefined,
        // is_inventoriable is Stockroom's call now, not the requester's — see
        // setItemInventoriable below. Every item starts Not Inventoriable
        // until Custodian classifies it during Stockroom review.
        items: items.map((i) => ({
          item_description: i.item_description.toUpperCase(),
          quantity: i.quantity,
          uom: i.uom || undefined,
        })),
      });
      log.info("Urgent request created successfully");
      resetUrgentForm();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create urgent request:", reason);
      alert("Error submitting urgent request: " + reason);
      return false;
    } finally {
      setIsSubmittingUrgent(false);
    }
  }, [urgentFormData, urgentItems, resetUrgentForm]);

  // ---- List + Stockroom review (Custodian side) ----
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>([]);
  const [loadingUrgentRequests, setLoadingUrgentRequests] = useState(true);

  const loadUrgentRequests = useCallback(async () => {
    try {
      setUrgentRequests(await getUrgentRequestsAction());
    } catch (error) {
      log.error("Failed to load urgent requests:", error);
    } finally {
      setLoadingUrgentRequests(false);
    }
  }, []);

  useEffect(() => {
    void loadUrgentRequests();
  }, [loadUrgentRequests]);

  useRequestsChanged(
    useCallback(
      (payload) => {
        if (payload.type === "urgent") void loadUrgentRequests();
      },
      [loadUrgentRequests]
    )
  );

  const reviewUrgentRequest = useCallback(async (id: number, decision: "approved" | "rejected", rejectionComment?: string): Promise<boolean> => {
    try {
      log.info(decision === "approved" ? "Approving urgent request:" : "Declining urgent request:", id);
      await urgentRequestAPI.reviewAsStockroom(id, { decision, rejection_comment: rejectionComment });
      await loadUrgentRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to review urgent request:", reason);
      alert("Error reviewing urgent request: " + reason);
      return false;
    }
  }, [loadUrgentRequests]);

  const reviewUrgentRequestAsSupervisor = useCallback(async (id: number, decision: "approved" | "rejected", rejectionComment?: string): Promise<boolean> => {
    try {
      log.info(decision === "approved" ? "Approving urgent request (supervisor):" : "Declining urgent request (supervisor):", id);
      await reviewSupervisorRequestAction({
        type: "urgent",
        id,
        decision,
        rejectionComment,
      });
      await loadUrgentRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to review urgent request as supervisor:", reason);
      alert("Error reviewing urgent request: " + reason);
      return false;
    }
  }, [loadUrgentRequests]);

  // A fellow supervisor can't approve a supervisor-created request — needs a
  // manager (or admin) — same rule useSupervisorRequests.ts's
  // canApproveRequest already enforces for item/service requests. Route-level
  // gate is server-side (reviewAsSupervisor); this only drives whether the
  // Approve/Decline buttons render.
  const canApproveUrgentAsSupervisor = useCallback((row: UrgentRequest): boolean => {
    const approverRole = user?.role?.toLowerCase();
    if (approverRole === "manager" || approverRole === "admin" || approverRole === "operations_manager") return true;
    return row.created_by_role?.toLowerCase() !== "supervisor";
  }, [user?.role]);

  // Click-to-expand row state, same single-row-open accordion pattern the
  // Item/Service request lists use (useRequestManagement.ts's handleRowClick)
  // — no separate detail fetch needed here since the full row is already
  // loaded by loadUrgentRequests.
  const [expandedUrgentIds, setExpandedUrgentIds] = useState<Set<number>>(new Set());
  const toggleUrgentRow = useCallback((id: number) => {
    setExpandedUrgentIds((prev) => {
      const next = new Set<number>();
      if (!prev.has(id)) next.add(id);
      return next;
    });
  }, []);

  // ---- Purchaser Dashboard, Phase 2 — per-item Purchase Order / Payment
  // Request classification ----
  const [savingItemTransactionId, setSavingItemTransactionId] = useState<number | null>(null);

  const setItemPurchasingTransaction = useCallback(async (
    requestId: number,
    itemId: number,
    transaction: "purchase_order" | "payment_request",
    amount?: number
  ): Promise<boolean> => {
    setSavingItemTransactionId(itemId);
    try {
      log.info("Routing urgent request item:", itemId, "as", transaction);
      await urgentRequestAPI.updateItemTransaction(requestId, itemId, { purchasing_transaction: transaction, amount });
      await loadUrgentRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to set item purchasing transaction:", reason);
      alert("Error saving transaction type: " + reason);
      return false;
    } finally {
      setSavingItemTransactionId(null);
    }
  }, [loadUrgentRequests]);

  // ---- Stockroom (Custodian) review — the sole place Inventoriable/Not is
  // set now; the requester no longer picks it at creation. ----
  const [savingItemInventoriableId, setSavingItemInventoriableId] = useState<number | null>(null);

  const setItemInventoriable = useCallback(async (
    requestId: number,
    itemId: number,
    isInventoriable: boolean
  ): Promise<boolean> => {
    setSavingItemInventoriableId(itemId);
    try {
      log.info("Classifying urgent request item:", itemId, "as", isInventoriable ? "Inventoriable" : "Not Inventoriable");
      await urgentRequestAPI.setItemInventoriable(requestId, itemId, { is_inventoriable: isInventoriable });
      await loadUrgentRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to set item inventoriable:", reason);
      alert("Error saving Inventoriable status: " + reason);
      return false;
    } finally {
      setSavingItemInventoriableId(null);
    }
  }, [loadUrgentRequests]);

  // ---- Delivery self-attestation — Not Inventoriable items only. The
  // requesting department confirms receipt themselves, since those items
  // skip Custodian/inventory tracking entirely. ----
  const [savingItemDeliveryId, setSavingItemDeliveryId] = useState<number | null>(null);

  const setItemDeliveryStatus = useCallback(async (
    requestId: number,
    itemId: number,
    deliveryStatus: "pending" | "delivered" | "partial_delivered",
    quantityDelivered?: number
  ): Promise<boolean> => {
    setSavingItemDeliveryId(itemId);
    try {
      log.info("Setting urgent request item delivery status:", itemId, "->", deliveryStatus);
      await urgentRequestAPI.updateItemDeliveryStatus(requestId, itemId, { delivery_status: deliveryStatus, quantity_delivered: quantityDelivered });
      await loadUrgentRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to set item delivery status:", reason);
      alert("Error saving delivery status: " + reason);
      return false;
    } finally {
      setSavingItemDeliveryId(null);
    }
  }, [loadUrgentRequests]);

  // ---- Purchaser Dashboard, Phase 3 — Payment Request Form (F-ACC-003) ----
  const [paymentRequestFormRequestId, setPaymentRequestFormRequestId] = useState<number | null>(null);
  const [paymentRequestForm, setPaymentRequestForm] = useState<PaymentRequestForm | null>(null);
  const [loadingPaymentRequestForm, setLoadingPaymentRequestForm] = useState(false);
  const [savingPaymentRequestForm, setSavingPaymentRequestForm] = useState(false);

  const openPaymentRequestForm = useCallback(async (requestId: number) => {
    setPaymentRequestFormRequestId(requestId);
    setPaymentRequestForm(null);
    setLoadingPaymentRequestForm(true);
    try {
      const res = await urgentRequestAPI.getPaymentRequestForm(requestId);
      setPaymentRequestForm(res.data);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to load payment request form:", reason);
      alert("Error loading Payment Request Form: " + reason);
      setPaymentRequestFormRequestId(null);
    } finally {
      setLoadingPaymentRequestForm(false);
    }
  }, []);

  const closePaymentRequestForm = useCallback(() => {
    setPaymentRequestFormRequestId(null);
    setPaymentRequestForm(null);
  }, []);

  const savePaymentRequestFormFields = useCallback(async (
    requestId: number,
    fields: Partial<Pick<PaymentRequestForm, "payee" | "department" | "date" | "date_needed" | "note" | "prepared_by" | "checked_by" | "approved_by">> & { total_amount_due?: number }
  ): Promise<boolean> => {
    setSavingPaymentRequestForm(true);
    try {
      const res = await urgentRequestAPI.savePaymentRequestForm(requestId, fields);
      setPaymentRequestForm(res.data);
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to save payment request form:", reason);
      alert("Error saving Payment Request Form: " + reason);
      return false;
    } finally {
      setSavingPaymentRequestForm(false);
    }
  }, []);

  // "Submitted Payment Request" — the Purchaser's one-way submit action,
  // locking the form to AP Officer edits from here on.
  const [submittingPaymentRequestForm, setSubmittingPaymentRequestForm] = useState(false);

  const submitPaymentRequestForm = useCallback(async (requestId: number): Promise<boolean> => {
    setSubmittingPaymentRequestForm(true);
    try {
      const res = await urgentRequestAPI.submitPaymentRequestForm(requestId);
      setPaymentRequestForm(res.data);
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to submit payment request form:", reason);
      alert("Error submitting Payment Request Form: " + reason);
      return false;
    } finally {
      setSubmittingPaymentRequestForm(false);
    }
  }, []);

  return {
    urgentFormData,
    setUrgentFormData,
    urgentItems,
    addUrgentItemRow,
    removeUrgentItemRow,
    updateUrgentItemRow,
    isSubmittingUrgent,
    submitUrgentRequest,
    urgentRequests,
    loadingUrgentRequests,
    reviewUrgentRequest,
    reviewUrgentRequestAsSupervisor,
    canApproveUrgentAsSupervisor,
    expandedUrgentIds,
    toggleUrgentRow,
    setItemPurchasingTransaction,
    savingItemTransactionId,
    setItemInventoriable,
    savingItemInventoriableId,
    setItemDeliveryStatus,
    savingItemDeliveryId,
    paymentRequestFormRequestId,
    paymentRequestForm,
    loadingPaymentRequestForm,
    savingPaymentRequestForm,
    openPaymentRequestForm,
    closePaymentRequestForm,
    savePaymentRequestFormFields,
    submitPaymentRequestForm,
    submittingPaymentRequestForm,
  };
}
