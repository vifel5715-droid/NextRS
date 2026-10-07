import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@app/providers/AuthProvider";
import { reimbursementRequestAPI } from "../../../services/api";
import { createLogger } from "@shared/utils/logger";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import { getErrorMessage } from "@shared/utils/errorMessage";
import type { ReimbursementRequest, ReimbursementRequestItem } from "@shared/types";

const log = createLogger("useReimbursementRequests");

const emptyReimbursementItem: ReimbursementRequestItem = { item_description: "", quantity: undefined, uom: "", amount: "" };

/**
 * Owns the Reimbursement Request workflow — its own hook, same reasoning as
 * useUrgentRequests.ts: a genuinely separate, additive feature (own tables,
 * own list, own three-stage review) that StaffDashboard.tsx (create side),
 * SupervisorDashboard.tsx, PurchaserDashboard.tsx, and APOfficerDashboard.tsx
 * (each one review stage) all pull in independently.
 */
export function useReimbursementRequests() {
  const { user } = useAuth();

  // ---- Create form (requester side) ----
  const [reimbursementFormData, setReimbursementFormData] = useState({ department: "", requested_by: "", purpose: "", remarks: "", date_needed: "", supplier: "" });
  const [reimbursementItems, setReimbursementItems] = useState<ReimbursementRequestItem[]>([{ ...emptyReimbursementItem }]);
  const [isSubmittingReimbursement, setIsSubmittingReimbursement] = useState(false);

  const resetReimbursementForm = useCallback(() => {
    setReimbursementFormData({ department: user?.department || "", requested_by: user?.name || "", purpose: "", remarks: "", date_needed: "", supplier: "" });
    setReimbursementItems([{ ...emptyReimbursementItem }]);
  }, [user?.department, user?.name]);

  // Defaults Requested By to whoever is logged in — same as
  // useStaffRequests.ts's item/service Create form. Without this it stayed
  // permanently blank (never set anywhere else) for every non-Secretary
  // role, since Secretary alone types it manually via itemRequesterName.
  useEffect(() => {
    setReimbursementFormData((f) => ({ ...f, department: user?.department || f.department, requested_by: f.requested_by || user?.name || "" }));
  }, [user?.department, user?.name]);

  const addReimbursementItemRow = () => setReimbursementItems((prev) => [...prev, { ...emptyReimbursementItem }]);

  const removeReimbursementItemRow = (index: number) => {
    if (reimbursementItems.length > 1) setReimbursementItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateReimbursementItemRow = (index: number, field: keyof ReimbursementRequestItem, value: string | number | undefined) =>
    setReimbursementItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });

  const reimbursementTotalCost = reimbursementItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  const submitReimbursementRequest = useCallback(async (): Promise<boolean> => {
    if (!reimbursementFormData.department) {
      alert("Please select a department.");
      return false;
    }
    if (!reimbursementFormData.purpose.trim()) {
      alert("Purpose is required.");
      return false;
    }
    if (!reimbursementFormData.supplier.trim()) {
      alert("Supplier is required.");
      return false;
    }
    const items = reimbursementItems.filter((i) => i.item_description.trim());
    if (items.length === 0) {
      alert("Enter at least one item.");
      return false;
    }
    if (items.some((i) => !i.amount || Number(i.amount) <= 0)) {
      alert("Enter a valid amount for every item.");
      return false;
    }

    setIsSubmittingReimbursement(true);
    try {
      log.info("Submitting reimbursement request — department:", reimbursementFormData.department, "items:", items.length);
      await reimbursementRequestAPI.create({
        department: reimbursementFormData.department,
        requested_by: reimbursementFormData.requested_by || undefined,
        purpose: reimbursementFormData.purpose.toUpperCase(),
        remarks: reimbursementFormData.remarks ? reimbursementFormData.remarks.toUpperCase() : undefined,
        date_needed: reimbursementFormData.date_needed || undefined,
        supplier: reimbursementFormData.supplier.toUpperCase(),
        items: items.map((i) => ({
          item_description: i.item_description.toUpperCase(),
          quantity: i.quantity,
          uom: i.uom || undefined,
          amount: Number(i.amount),
        })),
      });
      log.info("Reimbursement request created successfully");
      resetReimbursementForm();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create reimbursement request:", reason);
      alert("Error submitting reimbursement request: " + reason);
      return false;
    } finally {
      setIsSubmittingReimbursement(false);
    }
  }, [reimbursementFormData, reimbursementItems, resetReimbursementForm]);

  // ---- List + three-stage review (Supervisor / Purchaser / AP Officer) ----
  const [reimbursementRequests, setReimbursementRequests] = useState<ReimbursementRequest[]>([]);
  const [loadingReimbursementRequests, setLoadingReimbursementRequests] = useState(true);

  const loadReimbursementRequests = useCallback(async () => {
    try {
      const res = await reimbursementRequestAPI.getAll();
      setReimbursementRequests(res.data);
    } catch (error) {
      log.error("Failed to load reimbursement requests:", error);
    } finally {
      setLoadingReimbursementRequests(false);
    }
  }, []);

  useEffect(() => {
    void loadReimbursementRequests();
  }, [loadReimbursementRequests]);

  useRequestsChanged(
    useCallback(
      (payload) => {
        if (payload.type === "reimbursement") void loadReimbursementRequests();
      },
      [loadReimbursementRequests]
    )
  );

  const reviewReimbursementAsSupervisor = useCallback(async (id: number, decision: "approved" | "rejected", rejectionComment?: string): Promise<boolean> => {
    try {
      log.info(decision === "approved" ? "Approving reimbursement request:" : "Declining reimbursement request:", id);
      await reimbursementRequestAPI.reviewAsSupervisor(id, { decision, rejection_comment: rejectionComment });
      await loadReimbursementRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to review reimbursement request:", reason);
      alert("Error reviewing reimbursement request: " + reason);
      return false;
    }
  }, [loadReimbursementRequests]);

  const reviewReimbursementAsPurchaser = useCallback(async (id: number, decision: "approved" | "rejected", rejectionComment?: string): Promise<boolean> => {
    try {
      log.info(decision === "approved" ? "Approving (Purchaser) reimbursement request:" : "Declining (Purchaser) reimbursement request:", id);
      await reimbursementRequestAPI.reviewAsPurchaser(id, { decision, rejection_comment: rejectionComment });
      await loadReimbursementRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to review reimbursement request as purchaser:", reason);
      alert("Error reviewing reimbursement request: " + reason);
      return false;
    }
  }, [loadReimbursementRequests]);

  const reviewReimbursementAsAPOfficer = useCallback(async (id: number, decision: "approved" | "rejected", rejectionComment?: string): Promise<boolean> => {
    try {
      log.info(decision === "approved" ? "Approving (AP Officer) reimbursement request:" : "Declining (AP Officer) reimbursement request:", id);
      await reimbursementRequestAPI.reviewAsAPOfficer(id, { decision, rejection_comment: rejectionComment });
      await loadReimbursementRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to review reimbursement request as AP officer:", reason);
      alert("Error reviewing reimbursement request: " + reason);
      return false;
    }
  }, [loadReimbursementRequests]);

  // AP Officer only, only reachable once ap_status is already "approved" —
  // marks the money as actually disbursed/received.
  const closeReimbursementRequest = useCallback(async (id: number): Promise<boolean> => {
    try {
      log.info("Closing reimbursement request:", id);
      await reimbursementRequestAPI.close(id);
      await loadReimbursementRequests();
      return true;
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to close reimbursement request:", reason);
      alert("Error closing reimbursement request: " + reason);
      return false;
    }
  }, [loadReimbursementRequests]);

  // A fellow supervisor can't approve a supervisor-created request — needs a
  // manager (or admin) — same rule useUrgentRequests.ts's
  // canApproveUrgentAsSupervisor already enforces for the Urgent Request
  // workflow. Route-level gate is server-side; this only drives whether the
  // Approve/Decline buttons render.
  const canApproveReimbursementAsSupervisor = useCallback((row: ReimbursementRequest): boolean => {
    const approverRole = user?.role?.toLowerCase();
    if (approverRole === "manager" || approverRole === "admin" || approverRole === "operations_manager") return true;
    return row.created_by_role?.toLowerCase() !== "supervisor";
  }, [user?.role]);

  // Click-to-expand row state, same single-row-open accordion pattern the
  // Item/Service/Urgent request lists use.
  const [expandedReimbursementIds, setExpandedReimbursementIds] = useState<Set<number>>(new Set());
  const toggleReimbursementRow = useCallback((id: number) => {
    setExpandedReimbursementIds((prev) => {
      const next = new Set<number>();
      if (!prev.has(id)) next.add(id);
      return next;
    });
  }, []);

  return {
    reimbursementFormData,
    setReimbursementFormData,
    reimbursementItems,
    addReimbursementItemRow,
    removeReimbursementItemRow,
    updateReimbursementItemRow,
    reimbursementTotalCost,
    isSubmittingReimbursement,
    submitReimbursementRequest,
    reimbursementRequests,
    loadingReimbursementRequests,
    reviewReimbursementAsSupervisor,
    reviewReimbursementAsPurchaser,
    reviewReimbursementAsAPOfficer,
    closeReimbursementRequest,
    canApproveReimbursementAsSupervisor,
    expandedReimbursementIds,
    toggleReimbursementRow,
  };
}
