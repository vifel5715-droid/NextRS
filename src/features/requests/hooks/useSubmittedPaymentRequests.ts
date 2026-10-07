import { useCallback, useEffect, useState } from "react";
import { urgentRequestAPI, itemRequestAPI } from "../../../services/api";
import { createLogger } from "@shared/utils/logger";
import { useRequestsChanged } from "@shared/hooks/useRequestsChanged";
import type { SubmittedPaymentRequest } from "@shared/types";

const log = createLogger("useSubmittedPaymentRequests");

/**
 * "Submitted Payment Request" sidebar page — merges the submitted F-ACC-003
 * forms from both sources (Urgent Request workflow's payment_request_forms,
 * "Urgent Item From IRS"'s item_payment_request_forms) into one list, newest
 * submission first. Each source's own list endpoint already filters to
 * submitted = true and applies its own permission/department scoping
 * server-side — this just fetches both and interleaves them.
 */
export function useSubmittedPaymentRequests() {
  const [requests, setRequests] = useState<SubmittedPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [urgentRes, itemRes] = await Promise.all([
        urgentRequestAPI.getSubmittedPaymentRequestForms(),
        itemRequestAPI.getSubmittedPaymentRequestForms(),
      ]);
      const merged = [...urgentRes.data, ...itemRes.data].sort((a, b) =>
        (b.submitted_at || "").localeCompare(a.submitted_at || "")
      );
      setRequests(merged);
    } catch (error) {
      log.error("Failed to load submitted payment requests:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // submitPaymentRequestForm/submitItemPaymentRequestForm both emit an
  // "updated" event on their underlying request when a form is submitted
  // (see urgent-request.service.ts) — refetching on that, rather than a
  // dedicated form-changed event, is the same coarse-but-sufficient signal
  // PurchaserDashboard.tsx's own urgent-request refetch already relies on.
  useRequestsChanged(
    useCallback(
      (payload) => {
        if (payload.type === "urgent" || payload.type === "item") void load();
      },
      [load]
    )
  );

  return { requests, loading, reload: load };
}
