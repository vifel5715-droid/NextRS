import type { RolePermissionGrant, UrgentRequestItem, PaymentRequestForm, ItemPaymentRequestForm, RequestDetail } from "@/types";
import { asResponse, type ActionResult } from "@/lib/utils/actionResult";
import { getItemRequestByIdAction, getServiceRequestByIdAction } from "@/features/requests/actions/request-lists";
import { getAttachmentStorageUsageAction } from "@/features/requests/actions/attachment-storage";
import { createReimbursementRequestAction } from "@/features/requests/actions/create-reimbursement-request";
import { getAdjustmentLogForRequestAction } from "@/features/reports/actions/history-reads";
import {
  deleteItemAttachmentAction,
  deleteRequestItemAction,
  getItemPaymentRequestFormAction,
  getPendingCountAction,
  getPurchasePaymentItemsAction,
  getSubmittedItemPaymentRequestsAction,
  replaceItemAttachmentAction,
  saveItemPaymentRequestFormAction,
  setItemCatalogLinkAction,
  setItemInventoriableAction,
  setItemPurchasingTransactionAction,
  submitItemPaymentRequestFormAction,
  updateItemRequestAction,
} from "@/features/requests/actions/item-request-mutations";
import {
  clearServiceReceivingReportAction,
  deleteServiceItemAction,
  updateServiceItemAction,
  updateServiceRequestAction,
} from "@/features/requests/actions/service-request-mutations";
import { deleteIssuanceAuditAction, resetRequestApprovalAction } from "@/features/requests/actions/status-mutations";
import {
  createUrgentRequestAction,
  getSubmittedUrgentPaymentRequestsAction,
  getUrgentPaymentRequestFormAction,
  reviewUrgentAsStockroomAction,
  saveUrgentPaymentRequestFormAction,
  setUrgentItemCatalogLinkAction,
  setUrgentItemDeliveryStatusAction,
  setUrgentItemInventoriableAction,
  setUrgentItemTransactionAction,
  submitUrgentPaymentRequestFormAction,
} from "@/features/requests/actions/urgent-request-mutations";
import {
  closeReimbursementAction,
  replaceReimbursementAttachmentAction,
  reviewReimbursementAsAPOfficerAction,
  reviewReimbursementAsPurchaserAction,
} from "@/features/requests/actions/reimbursement-mutations";
import {
  createPettyCashTransactionAction,
  getPettyCashCountsAction,
  getPettyCashCustodianNamesAction,
  getPettyCashTransactionsAction,
  setPettyCashCustodianStatusAction,
  setPettyCashRrNumberAction,
  updatePettyCashTransactionAction,
} from "@/features/petty-cash/actions/petty-cash";
import {
  createOptionListEntryAction,
  createRoleAction,
  deleteOptionListEntryAction,
  deleteRoleAction,
  recoverDeletionLogEntryAction,
  updateOptionListEntryAction,
  updateRoleAction,
} from "@/features/settings/actions/admin-mutations";

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
 * ARCH: every wrapper below is backed by a Next.js Server Action. These used
 * to be axios calls to the legacy Express REST API; after the move to
 * Next.js those URLs fell through to app/api/[...path]/route.ts, which
 * answers 501 "This endpoint has not been migrated to a Next.js Server
 * Action" for everything — the root cause of the failed urgent request,
 * service update, petty cash, and attachment operations. The wrappers keep
 * their old `{ data }` response shape so callers did not have to change.
 *
 * Mutations return an ActionResult (Next.js redacts thrown Server Action
 * messages in production); `call` unwraps it into a normal Error and routes
 * an expired session to the AuthProvider's handler, like the old axios 401
 * interceptor did.
 */
let onUnauthorized: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

const SESSION_EXPIRED = "Your session has expired. Please log in again.";

async function call<T>(promise: Promise<ActionResult<T>>): Promise<{ data: T }> {
  try {
    return await asResponse(promise);
  } catch (error) {
    if (error instanceof Error && error.message === SESSION_EXPIRED) onUnauthorized?.();
    throw error;
  }
}

/** Percent (0-100) uploaded. Server Actions expose no upload progress, so this reports 0 at the start and 100 when the upload finished. */
export type UploadProgressHandler = (percent: number) => void;

export const itemRequestAPI = {
  getById: async (id: number): Promise<{ data: RequestDetail }> => {
    const request = await getItemRequestByIdAction(id);
    return { data: { ...request } };
  },
  update: (id: number, data: RequestPayload) => call(updateItemRequestAction(id, data)),
  deleteItem: (id: number, reason: string) => call(deleteRequestItemAction(id, reason)),
  getPendingCount: (params?: { startDate?: string; endDate?: string }) => call(getPendingCountAction("item", params)),
  getPurchasePaymentItems: () => call(getPurchasePaymentItemsAction()),
  // "Urgent Item From IRS" page — classifies one URGENT item Purchase Order
  // vs Payment Request; amount required for Payment Request.
  setItemPurchasingTransaction: (id: number, data: { purchasing_transaction: "purchase_order" | "payment_request"; amount?: number }) =>
    call(setItemPurchasingTransactionAction(id, data)),
  // "Urgent Item From IRS" page — marks whether a Payment Request item is
  // real trackable stock. Feeds "Pending Item Entry".
  setItemInventoriable: (id: number, data: { is_inventoriable: boolean }) => call(setItemInventoriableAction(id, data)),
  // "Pending Item Entry" page — registers the Item Catalog entry name a
  // Payment Request + Inventoriable item corresponds to.
  setItemCatalogLink: (id: number, data: { catalog_item_name: string }) => call(setItemCatalogLinkAction(id, data)),
  getPaymentRequestForm: (requestId: number) => call(getItemPaymentRequestFormAction(requestId)),
  // total_amount_due is a manual override for the computed Particulars sum;
  // sending it as undefined clears the override.
  savePaymentRequestForm: (requestId: number, data: Partial<Omit<ItemPaymentRequestForm, "item_request_id" | "particulars" | "total_amount_due" | "submitted" | "submitted_by_name" | "submitted_at" | "created_at" | "updated_at">> & { total_amount_due?: number }) =>
    call(saveItemPaymentRequestFormAction(requestId, data)),
  submitPaymentRequestForm: (requestId: number) => call(submitItemPaymentRequestFormAction(requestId)),
  getSubmittedPaymentRequestForms: () => call(getSubmittedItemPaymentRequestsAction()),
  getStorageUsage: async (): Promise<{ data: { used: number; max: number } }> => ({
    data: await getAttachmentStorageUsageAction(),
  }),
  /** Same-origin URL that streams the PDF (inline by default, `?download=1` to save). */
  attachmentUrl: (id: number, download = false) => `/api/item-request/${id}/attachment${download ? "?download=1" : ""}`,
  replaceAttachment: async (id: number, file: File, onUploadProgress?: UploadProgressHandler) => {
    const formData = new FormData();
    formData.append("id", String(id));
    formData.append("attachment", file);
    onUploadProgress?.(0);
    const result = await call(replaceItemAttachmentAction(formData));
    onUploadProgress?.(100);
    return result;
  },
  deleteAttachment: (id: number) => call(deleteItemAttachmentAction(id)),
};

export const serviceRequestAPI = {
  getById: async (id: number): Promise<{ data: RequestDetail }> => {
    const request = await getServiceRequestByIdAction(id);
    return { data: { ...request } };
  },
  update: (id: number, data: RequestPayload) => call(updateServiceRequestAction(id, data)),
  getPendingCount: (params?: { startDate?: string; endDate?: string }) => call(getPendingCountAction("service", params)),
  deleteItem: (id: number, reason: string) => call(deleteServiceItemAction(id, reason)),
};

export const deletionLogAPI = {
  recover: (id: number) => call(recoverDeletionLogEntryAction(id)),
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

export const optionListAPI = {
  create: (kind: "item_type" | "uom" | "machine_code" | "item_group" | "department", value: string, description?: string) =>
    call(createOptionListEntryAction(kind, value, description)),
  update: (id: number, value: string, description?: string) => call(updateOptionListEntryAction(id, value, description)),
  delete: (id: number) => call(deleteOptionListEntryAction(id)),
};

export const rolesAPI = {
  create: (data: { name: string; label: string; permissions: RolePermissionGrant[] }) => call(createRoleAction(data)),
  update: (id: number, data: { label: string; permissions: RolePermissionGrant[] }) => call(updateRoleAction(id, data)),
  delete: (id: number) => call(deleteRoleAction(id)),
};

export const urgentRequestAPI = {
  // is_inventoriable is Stockroom's call, set later via setItemInventoriable
  // below — the requester never submits it.
  create: (data: { department: string; requested_by?: string; purpose: string; remarks?: string; date_needed?: string; items: Array<Omit<UrgentRequestItem, "is_inventoriable">> }) =>
    call(createUrgentRequestAction(data)),
  reviewAsStockroom: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    call(reviewUrgentAsStockroomAction(id, data)),
  updateItemTransaction: (requestId: number, itemId: number, data: { purchasing_transaction: "purchase_order" | "payment_request"; amount?: number }) =>
    call(setUrgentItemTransactionAction(requestId, itemId, data)),
  updateItemDeliveryStatus: (requestId: number, itemId: number, data: { delivery_status: "pending" | "delivered" | "partial_delivered"; quantity_delivered?: number }) =>
    call(setUrgentItemDeliveryStatusAction(requestId, itemId, data)),
  // Stockroom (Custodian) review — the only place an item's Inventoriable
  // classification is set, since the requester no longer submits it.
  setItemInventoriable: (requestId: number, itemId: number, data: { is_inventoriable: boolean }) =>
    call(setUrgentItemInventoriableAction(requestId, itemId, data)),
  // "New Item List" page — registers the Item Catalog entry name an
  // Inventoriable Urgent Request item corresponds to.
  setItemCatalogLink: (requestId: number, itemId: number, data: { catalog_item_name: string }) =>
    call(setUrgentItemCatalogLinkAction(requestId, itemId, data)),
  getPaymentRequestForm: (requestId: number) => call(getUrgentPaymentRequestFormAction(requestId)),
  savePaymentRequestForm: (requestId: number, data: Partial<Omit<PaymentRequestForm, "urgent_request_id" | "particulars" | "total_amount_due" | "submitted" | "submitted_by_name" | "submitted_at" | "created_at" | "updated_at">> & { total_amount_due?: number }) =>
    call(saveUrgentPaymentRequestFormAction(requestId, data)),
  submitPaymentRequestForm: (requestId: number) => call(submitUrgentPaymentRequestFormAction(requestId)),
  getSubmittedPaymentRequestForms: () => call(getSubmittedUrgentPaymentRequestsAction()),
};

export const reimbursementRequestAPI = {
  // Supplier and each item's Amount are sent up front — there's no later
  // Purchaser classification step for this workflow.
  create: (formData: FormData) => call(createReimbursementRequestAction(formData)),
  reviewAsPurchaser: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    call(reviewReimbursementAsPurchaserAction(id, data)),
  reviewAsAPOfficer: (id: number, data: { decision: "approved" | "rejected"; rejection_comment?: string }) =>
    call(reviewReimbursementAsAPOfficerAction(id, data)),
  // AP Officer only, only once ap_status is "approved" — marks the money as
  // actually disbursed/received.
  close: (id: number) => call(closeReimbursementAction(id)),
  attachmentUrl: (id: number, download = false) => `/api/reimbursement-request/${id}/attachment${download ? "?download=1" : ""}`,
  replaceAttachment: (id: number, file: File) => {
    const formData = new FormData();
    formData.append("id", String(id));
    formData.append("attachment", file);
    return call(replaceReimbursementAttachmentAction(formData));
  },
};

// Petty Cash — a simple, independent ledger entry, no approval chain.
// Custodian and AP Officer both create/edit po_number/total_amount;
// cash_received is AP Officer's alone to set (enforced server-side).
export const pettyCashAPI = {
  getAll: (status?: "pending" | "delivered") => call(getPettyCashTransactionsAction(status)),
  getCounts: () => call(getPettyCashCountsAction()),
  setCustodianStatus: (id: number, data: { cash_status?: "received" | "not_received"; item_status?: "delivered" | "pending" }) =>
    call(setPettyCashCustodianStatusAction(id, data)),
  // Custodian (or admin) only — the server rejects anyone else.
  setRrNumber: (id: number, rrNumber: string) => call(setPettyCashRrNumberAction(id, { rr_number: rrNumber })),
  create: (data: { po_number: string; total_amount: number }) => call(createPettyCashTransactionAction(data)),
  // PO Number and Total Amount only — the server rejects any other field.
  update: (id: number, data: { po_number?: string; total_amount?: number; expected_updated_at?: string }) =>
    call(updatePettyCashTransactionAction(id, data)),
  // Name of Receiver's suggestion list — Custodian is who actually hands
  // out petty cash day to day.
  getCustodianNames: () => call(getPettyCashCustodianNamesAction()),
};

export const statusAPI = {
  deleteIssuanceAudit: (id: number, reason: string) => call(deleteIssuanceAuditAction(id, reason)),
  updateServiceItem: (id: number, data: { description?: string; delivery_status?: string; pr_number?: string; pr_status?: string; receiving_report_no?: string }) =>
    call(updateServiceItemAction(id, data)),
  clearServiceReceivingReport: (id: number, reason: string) => call(clearServiceReceivingReportAction(id, reason)),
  resetItemApproval: (id: number, target?: "supervisor" | "custodian") => call(resetRequestApprovalAction("item", id, target)),
  resetServiceApproval: (id: number, target?: "supervisor" | "custodian") => call(resetRequestApprovalAction("service", id, target)),
};
