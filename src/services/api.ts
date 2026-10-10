import axios from "axios";
import type { ItemCatalogEntry, OptionListEntry, ApprovalLevel, RoleWithPermissions, RolePermissionGrant, UrgentRequest, UrgentRequestItem, PaymentRequestForm, ItemPaymentRequestForm, SubmittedPaymentRequest, ReimbursementRequest, PettyCashTransaction, RequestDetail } from "@shared/types";
import { getItemRequestByIdAction, getServiceRequestByIdAction } from "@server/actions/request-lists";
import { getAttachmentStorageUsageAction } from "@server/actions/attachment-storage";
import { createReimbursementRequestAction } from "@server/actions/create-reimbursement-request";
import { getAdjustmentLogForRequestAction } from "@server/actions/history-reads";

const API_BASE_URL = "/api";

/**
 * Bodies these wrappers only forward to the server. Typed as an open record
 * rather than a concrete shape because each caller assembles its own payload
 * (create vs. partial update vs. items-only) and the server validates with zod
 * anyway — a narrower type here would be fiction, not safety.
 */
export type RequestPayload = Record<string, unknown>;

export type UserPayload = Record<string, unknown>;

export interface PendingItem {
  id: number;
  serial: string;
  purpose: string;
  status: string;
  supervisor_status: string | null;
  custodian_status: string | null;
  created_at: string;
  items: {
    item_name: string;
    delivery_status: string | null;
    pr_number: string | null;
    /** Quantity still awaiting delivery against the request. */
    partial_qty: number;
    machine_code: string | null;
  }[];
}

export interface PurchasePaymentItem {
  id: number;
  serial: string;
  purpose: string;
  status: string;
  supervisor_status: string | null;
  custodian_status: string | null;
  created_at: string;
  items: {
    /** item_request_items row id — needed to call setItemPurchasingTransaction. */
    id: number;
    item_name: string;
    delivery_status: string | null;
    /** "PURCHASE REQUEST" | "URGENT" snapshot — stays put even once delivery_status moves on. */
    pr_type: string | null;
    pr_number: string | null;
    quantity: number;
    uom: string;
    /** Quantity still awaiting delivery against the request. */
    partial_qty: number;
    quantity_out: number;
    /** Still awaiting release to the requester — same "Balance" figure shown elsewhere in the app. */
    qty_balance: number;
    machine_code: string | null;
    /** Custodian/admin-entered deadline for a URGENT item. ISO date string. */
    date_needed: string | null;
    /** "Urgent Item From IRS" page — Purchase Order vs Payment Request classification. */
    purchasing_transaction: "purchase_order" | "payment_request" | null;
    /** Only meaningful once purchasing_transaction = "payment_request" — numeric column, returned as a string. */
    amount: string | null;
    /** "Urgent Item From IRS" page — real trackable stock vs a one-off consumable. Feeds "Pending Item Entry". */
    is_inventoriable: boolean;
    /** "Pending Item Entry" page — the Item Catalog entry name registered against this item, once entered. */
    catalog_item_name: string | null;
    /** False once the item has moved past the PR/Payment stage — delivered, held, or released OUT. */
    is_active: boolean;
  }[];
}

export interface PendingService {
  id: number;
  serial: string;
  purpose: string;
  status: string;
  supervisor_status: string | null;
  custodian_status: string | null;
  created_at: string;
  /** PR Number/Status live once on the request itself, not per service line. */
  pr_number: string | null;
  pr_status: string | null;
  services: {
    description: string;
  }[];
}

export interface DeliveredItem {
  id: number;
  serial: string;
  purpose: string;
  status: string;
  supervisor_status: string | null;
  custodian_status: string | null;
  created_at: string;
  items: {
    item_name: string;
    delivery_status: string | null;
    pr_status: string | null;
    /** "PURCHASE REQUEST" | "URGENT" snapshot — see item_request_items.pr_type. */
    pr_type: string | null;
    pr_number: string | null;
    quantity: number;
    quantity_delivered: number | null;
    quantity_out: number | null;
    /** Something is still outstanding — decided server-side so every view agrees. */
    is_partial: boolean;
    machine_code: string | null;
    /** When this arrived — the latest "PARTIAL" issuance audit's timestamp, or null if never recorded. */
    date_received: string | null;
  }[];
}

export interface OutedItem {
  id: number;
  serial: string;
  purpose: string;
  status: string;
  supervisor_status: string | null;
  custodian_status: string | null;
  items: {
    item_name: string;
    issuance_number: string | null;
    quantity: number;
    quantity_out: number | null;
    machine_code: string | null;
    /** Most recent OUT release date for this item. */
    issued_at: string | null;
  }[];
}

export interface DeletionLogEntry {
  id: number;
  request_type: "item" | "service" | "audit" | "rr";
  request_id: number | null;
  request_serial: string;
  department: string;
  entity_name: string;
  quantity: number | null;
  uom: string | null;
  issued_by_name: string | null;
  reason: string;
  deleted_by_name: string | null;
  deleted_at: string;
  recovered_at: string | null;
}

/**
 * Transitional CSRF token for REST endpoints not yet migrated to Server
 * Actions. Next.js validates the origin of Server Action requests.
 */
let csrfToken: string | null = null;

/**
 * Called when the server says the session is gone. AuthContext registers a
 * handler so React state clears; the fallback hard-redirects for calls that
 * happen outside the provider.
 */
let onUnauthorized: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

const MUTATING_METHODS = ["post", "put", "patch", "delete"];

const isMutating = (method?: string) =>
  !!method && MUTATING_METHODS.includes(method.toLowerCase());

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    // Skips ngrok's free-tier browser-warning interstitial when the API is
    // tunneled through *.ngrok-free.dev/.app for LAN/remote testing. Ignored
    // by the server and by any non-ngrok host, so safe to send always.
    "ngrok-skip-browser-warning": "true",
  },
  // Sends the httpOnly auth cookie on every request. This is the entire
  // authentication mechanism now — there is no Authorization header.
  withCredentials: true,
});

/**
 * Fetch the session's CSRF token if we don't have one in memory. The endpoint
 * is a GET, so it never re-enters the CSRF path below. Concurrent callers
 * share one in-flight request.
 */
let csrfPromise: Promise<string | null> | null = null;

export const ensureCsrfToken = async (): Promise<string | null> => {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = api
      .get("/auth/csrf")
      .then((res) => {
        csrfToken = res.data?.csrfToken ?? null;
        return csrfToken;
      })
      .catch(() => null)
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
};

api.interceptors.request.use(async (config) => {
  if (isMutating(config.method)) {
    const token = csrfToken ?? (await ensureCsrfToken());
    if (token) {
      config.headers["X-CSRF-Token"] = token;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;
    const url: string = config?.url ?? "";

    // /auth/login failing with 401 is "wrong password", and /auth/me failing
    // with 401 is the normal "not logged in" answer during bootstrap —
    // neither should trigger the session-expired path.
    const isAuthProbe = url.includes("/auth/login") || url.includes("/auth/me");

    if (status === 401 && !isAuthProbe) {
      csrfToken = null;
      if (onUnauthorized) {
        onUnauthorized();
      } else {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }

    // A CSRF rejection is recoverable: the server restarted, or the session
    // outlived our in-memory copy of the token. Re-fetch once and replay.
    // `_csrfRetry` bounds it to a single attempt so a genuinely rejected
    // request cannot loop.
    if (status === 403 && error.response?.data?.code === "CSRF_INVALID" && config && !config._csrfRetry) {
      config._csrfRetry = true;
      csrfToken = null;
      const token = await ensureCsrfToken();
      if (token) {
        // Mutate rather than replace: config.headers is an AxiosHeaders
        // instance, and spreading it into a plain object drops its prototype
        // (and with it the Content-Type handling for FormData uploads).
        config.headers["X-CSRF-Token"] = token;
        return api.request(config);
      }
    }

    if (status === 403) {
      console.error("Forbidden: You don't have permission to access this resource");
    }
    return Promise.reject(error);
  }
);

/** Percent (0-100) uploaded so far — passed to axios's onUploadProgress for attachment uploads. */
export type UploadProgressHandler = (percent: number) => void;

const toUploadProgressConfig = (onUploadProgress?: UploadProgressHandler) =>
  onUploadProgress
    ? {
        onUploadProgress: (e: { loaded: number; total?: number }) =>
          onUploadProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      }
    : undefined;

export const itemRequestAPI = {
  getById: async (id: number): Promise<{ data: RequestDetail }> => {
    const request = await getItemRequestByIdAction(id);
    return { data: { ...request } };
  },
  update: (id: number, data: RequestPayload) => api.put(`/item-request/${id}`, data),
  delete: (id: number, reason: string) => api.delete(`/item-request/${id}`, { data: { reason } }),
  deleteItem: (id: number, reason: string) => api.delete(`/item-request/item/${id}`, { data: { reason } }),
  getPendingCount: (params?: { startDate?: string; endDate?: string }) =>
    api.get<{ count: number }>("/item-request/pending-count", { params }),
  getPendingItems: () => api.get<PendingItem[]>("/item-request/pending-items"),
  getPurchasePaymentItems: () => api.get<PurchasePaymentItem[]>("/item-request/purchase-payment-items"),
  // "Urgent Item From IRS" page — classifies one URGENT item Purchase Order
  // vs Payment Request; amount required for Payment Request.
  setItemPurchasingTransaction: (id: number, data: { purchasing_transaction: "purchase_order" | "payment_request"; amount?: number }) =>
    api.put(`/item-request/request-item/${id}/purchasing-transaction`, data),
  // "Urgent Item From IRS" page — marks whether a Payment Request item is
  // real trackable stock. Feeds "Pending Item Entry".
  setItemInventoriable: (id: number, data: { is_inventoriable: boolean }) =>
    api.put(`/item-request/request-item/${id}/inventoriable`, data),
  // "Pending Item Entry" page — registers the Item Catalog entry name a
  // Payment Request + Inventoriable item corresponds to.
  setItemCatalogLink: (id: number, data: { catalog_item_name: string }) =>
    api.put(`/item-request/request-item/${id}/catalog-item`, data),
  // "Urgent Item From IRS" page — the F-ACC-003 Payment Request Form for one
  // Item Request, mirroring urgentRequestAPI's version below.
  getPaymentRequestForm: (requestId: number) =>
    api.get<ItemPaymentRequestForm>(`/item-request/${requestId}/payment-request-form`),
  // total_amount_due is a manual override for the computed Particulars sum —
  // sent as a number (server stores it as NUMERIC), unlike the string the
  // read side returns it as.
  savePaymentRequestForm: (requestId: number, data: Partial<Omit<ItemPaymentRequestForm, "item_request_id" | "particulars" | "total_amount_due" | "submitted" | "submitted_by_name" | "submitted_at" | "created_at" | "updated_at">> & { total_amount_due?: number }) =>
    api.put<ItemPaymentRequestForm>(`/item-request/${requestId}/payment-request-form`, data),
  // "Submitted Payment Request" — Purchaser/Custodian's one-way submit action
  // (locks the form to AP Officer edits), and the sidebar page's combined list.
  submitPaymentRequestForm: (requestId: number) =>
    api.put<ItemPaymentRequestForm>(`/item-request/${requestId}/payment-request-form/submit`, {}),
  getSubmittedPaymentRequestForms: () =>
    api.get<SubmittedPaymentRequest[]>("/item-request/payment-request-forms/submitted"),
  getStorageUsage: async (): Promise<{ data: { used: number; max: number } }> => ({
    data: await getAttachmentStorageUsageAction(),
  }),
  downloadAttachment: (id: number) => api.get(`/item-request/${id}/attachment`, { responseType: "blob" }),
  replaceAttachment: (id: number, file: File, onUploadProgress?: UploadProgressHandler) => {
    const formData = new FormData();
    formData.append("attachment", file);
    return api.put(`/item-request/${id}/attachment`, formData, {
      headers: { "Content-Type": undefined },
      ...toUploadProgressConfig(onUploadProgress),
    });
  },
  deleteAttachment: (id: number) => api.delete(`/item-request/${id}/attachment`),
};

export const serviceRequestAPI = {
  create: (data: RequestPayload) => api.post("/service-request", data),
  getById: async (id: number): Promise<{ data: RequestDetail }> => {
    const request = await getServiceRequestByIdAction(id);
    return { data: { ...request } };
  },
  update: (id: number, data: RequestPayload) => api.put(`/service-request/${id}`, data),
  getPendingCount: (params?: { startDate?: string; endDate?: string }) =>
    api.get<{ count: number }>("/service-request/pending-count", { params }),
  deleteItem: (id: number, reason: string) => api.delete(`/service-request/service-item/${id}`, { data: { reason } }),
};

export const deletionLogAPI = {
  recover: (id: number) => api.post(`/deletion-log/${id}/recover`),
};

export interface AdjustmentLogEntry {
  id: number;
  /** Reference number for the whole adjustment event this row is part of —
   * shared by every field changed in the same Save click. Null on rows
   * written before this existed and never backfilled. */
  adjustment_serial: string | null;
  request_id: number | null;
  request_serial: string;
  /** The request's own department — not what the UI displays as "Department". */
  department: string;
  item_label: string;
  field: string;
  before_value: string | null;
  after_value: string | null;
  adjustment_remarks: string;
  adjusted_by: string;
  adjusted_by_name: string;
  adjusted_by_role: string;
  /** Department of the user who made the adjustment — this is what the
   * Adjustment History table/print show as "Department". */
  adjusted_by_department: string;
  adjusted_at: string;
}

export const adjustmentLogAPI = {
  getForRequest: async (requestId: number, requestType: "item" | "service" | "petty_cash" = "item") => ({
    data: await getAdjustmentLogForRequestAction(requestId, requestType),
  }),
};

export interface ItemCatalogPayload {
  item_name: string;
  uom: string;
  machine_code?: string;
  item_group?: string;
  approval_level: ApprovalLevel;
  /** Department codes allowed to request this item — omit/empty for unrestricted. */
  departments?: string[];
}

export const itemCatalogAPI = {
  create: (data: ItemCatalogPayload) => api.post<ItemCatalogEntry>("/item-catalog", data),
  update: (id: number, data: ItemCatalogPayload) => api.put<ItemCatalogEntry>(`/item-catalog/${id}`, data),
  delete: (id: number) => api.delete(`/item-catalog/${id}`),
};

export const optionListAPI = {
  create: (kind: "item_type" | "uom" | "machine_code" | "item_group" | "department", value: string, description?: string) =>
    api.post<OptionListEntry>("/option-list", { kind, value, ...(description !== undefined ? { description } : {}) }),
  update: (id: number, value: string, description?: string) =>
    api.put<OptionListEntry>(`/option-list/${id}`, { value, ...(description !== undefined ? { description } : {}) }),
  delete: (id: number) => api.delete(`/option-list/${id}`),
};

export const rolesAPI = {
  create: (data: { name: string; label: string; permissions: RolePermissionGrant[] }) =>
    api.post<RoleWithPermissions>("/roles", data),
  update: (id: number, data: { label: string; permissions: RolePermissionGrant[] }) =>
    api.put<RoleWithPermissions>(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
};

export const urgentRequestAPI = {
  // is_inventoriable is Stockroom's call, set later via setItemInventoriable
  // below — the requester never submits it.
  create: (data: { department: string; requested_by?: string; purpose: string; remarks?: string; date_needed?: string; items: Array<Omit<UrgentRequestItem, "is_inventoriable">> }) =>
    api.post<UrgentRequest>("/urgent-request", data),
  getById: (id: number) => api.get<UrgentRequest>(`/urgent-request/${id}`),
  reviewAsSupervisor: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    api.put<UrgentRequest>(`/urgent-request/${id}/supervisor-review`, data),
  reviewAsStockroom: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    api.put<UrgentRequest>(`/urgent-request/${id}/stockroom-review`, data),
  updateItemTransaction: (requestId: number, itemId: number, data: { purchasing_transaction: "purchase_order" | "payment_request"; amount?: number }) =>
    api.put<UrgentRequest>(`/urgent-request/${requestId}/items/${itemId}/purchasing-transaction`, data),
  updateItemDeliveryStatus: (requestId: number, itemId: number, data: { delivery_status: "pending" | "delivered" | "partial_delivered"; quantity_delivered?: number }) =>
    api.put<UrgentRequest>(`/urgent-request/${requestId}/items/${itemId}/delivery-status`, data),
  // Stockroom (Custodian) review — the only place an item's Inventoriable
  // classification is set, since the requester no longer submits it.
  setItemInventoriable: (requestId: number, itemId: number, data: { is_inventoriable: boolean }) =>
    api.put<UrgentRequest>(`/urgent-request/${requestId}/items/${itemId}/inventoriable`, data),
  // "New Item List" page — registers the Item Catalog entry name an
  // Inventoriable Urgent Request item corresponds to, mirroring
  // itemRequestAPI.setItemCatalogLink above.
  setItemCatalogLink: (requestId: number, itemId: number, data: { catalog_item_name: string }) =>
    api.put<UrgentRequest>(`/urgent-request/${requestId}/items/${itemId}/catalog-item`, data),
  getPaymentRequestForm: (requestId: number) =>
    api.get<PaymentRequestForm>(`/urgent-request/${requestId}/payment-request-form`),
  // total_amount_due is a manual override for the computed Particulars sum —
  // sent as a number (server stores it as NUMERIC), unlike the string the
  // read side returns it as.
  savePaymentRequestForm: (requestId: number, data: Partial<Omit<PaymentRequestForm, "urgent_request_id" | "particulars" | "total_amount_due" | "submitted" | "submitted_by_name" | "submitted_at" | "created_at" | "updated_at">> & { total_amount_due?: number }) =>
    api.put<PaymentRequestForm>(`/urgent-request/${requestId}/payment-request-form`, data),
  // "Submitted Payment Request" — Purchaser's one-way submit action (locks
  // the form to AP Officer edits), and the sidebar page's combined list.
  submitPaymentRequestForm: (requestId: number) =>
    api.put<PaymentRequestForm>(`/urgent-request/${requestId}/payment-request-form/submit`, {}),
  getSubmittedPaymentRequestForms: () =>
    api.get<SubmittedPaymentRequest[]>("/urgent-request/payment-request-forms/submitted"),
};

export const reimbursementRequestAPI = {
  // Supplier and each item's Amount are sent up front, unlike
  // urgentRequestAPI.create — there's no later Purchaser classification
  // step for this workflow.
  create: (formData: FormData) => createReimbursementRequestAction(formData),
  getById: (id: number) => api.get<ReimbursementRequest>(`/reimbursement-request/${id}`),
  reviewAsSupervisor: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    api.put<ReimbursementRequest>(`/reimbursement-request/${id}/supervisor-review`, data),
  reviewAsPurchaser: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    api.put<ReimbursementRequest>(`/reimbursement-request/${id}/purchaser-review`, data),
  reviewAsAPOfficer: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    api.put<ReimbursementRequest>(`/reimbursement-request/${id}/ap-review`, data),
  // AP Officer only, only reachable once ap_status is already "approved" —
  // marks the money as actually disbursed/received.
  close: (id: number) => api.put<ReimbursementRequest>(`/reimbursement-request/${id}/close`),
};

// Petty Cash — a simple, independent ledger entry, no approval chain.
// Custodian and AP Officer both create/edit po_number/total_amount;
// cash_received is AP Officer's alone to set (enforced server-side).
export const pettyCashAPI = {
  getAll: () => api.get<PettyCashTransaction[]>("/petty-cash"),
  create: (data: { po_number: string; total_amount: number }) =>
    api.post<PettyCashTransaction>("/petty-cash", data),
  update: (id: number, data: { po_number?: string; total_amount?: number; cash_received?: number; receiver_name?: string }) =>
    api.put<PettyCashTransaction>(`/petty-cash/${id}`, data),
  // Name of Receiver's suggestion list — Custodian is who actually hands
  // out petty cash day to day.
  getCustodianNames: () => api.get<string[]>("/petty-cash/custodians"),
};

export const statusAPI = {
  updateItemRequest: (id: number, data: { status: string; rejection_comment?: string }) =>
    api.put(`/status/item/${id}`, data),
  updateServiceRequest: (id: number, data: { status: string; rejection_comment?: string }) =>
    api.put(`/status/service/${id}`, data),
  supervisorApproveItem: (id: number, data: { status: string; rejection_comment?: string }) =>
    api.put(`/status/supervisor/item/${id}`, data),
  supervisorApproveService: (id: number, data: { status: string; rejection_comment?: string }) =>
    api.put(`/status/supervisor/service/${id}`, data),
  addItemStatus: (data: RequestPayload) => api.post("/status/item", data),
  getItemHistory: (requestId: number) =>
    api.get(`/status/item/${requestId}/history`),
  updateItem: (id: number, data: { item_name?: string; quantity?: number; uom?: string; remarks?: string; machine_code?: string; issuance_number?: string; pr_number?: string; date_needed?: string; quantity_delivered?: number; quantity_out?: number; delivery_status?: string; pr_status?: string; adjustment_remarks?: string }) =>
    api.put(`/status/request-item/${id}`, data),
  deleteIssuanceAudit: (id: number, reason: string) => api.delete(`/status/issuance-audit/${id}`, { data: { reason } }),
  updateServiceItem: (id: number, data: { description?: string; delivery_status?: string; pr_number?: string; pr_status?: string; receiving_report_no?: string }) =>
    api.put(`/status/request-service-item/${id}`, data),
  clearServiceReceivingReport: (id: number, reason: string) =>
    api.delete(`/status/request-service-item/${id}/receiving-report`, { data: { reason } }),
  resetItemApproval: (id: number, target?: "supervisor" | "custodian") =>
    api.put(`/status/reset/item/${id}`, undefined, { params: target ? { target } : undefined }),
  resetServiceApproval: (id: number, target?: "supervisor" | "custodian") =>
    api.put(`/status/reset/service/${id}`, undefined, { params: target ? { target } : undefined }),
};

export const userAPI = {
  create: (data: UserPayload) => api.post("/users", data),
  getById: (id: string) => api.get(`/users/${id}`),
  update: (id: string, data: UserPayload) => api.put(`/users/${id}`, data),
  // Scoped server-side to the caller's own department — see users.controller.ts.
  getByDepartment: () => api.get<Array<{ id: string; name: string }>>("/users/by-department"),
};

export default api;
