export interface User {
  /** UUID — the server stores user ids as uuid, not serial. */
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  permissions: string[];
  /** Subset of `permissions` this role can also use the page's actions on, not just view — see server db/schema.ts's rolePermissions. Only has a real effect for "create_request" today; every other page's write actions are still gated by hardcoded role checks regardless of this. */
  editPermissions: string[];
}

/** Who can give the supervisor-stage approval on a request containing an item — see db/schema.ts's itemCatalog.approval_level. */
export type ApprovalLevel = "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER";

/** A custodian-maintained reference entry (name/type/UoM) — see db/schema.ts's itemCatalog. */
export interface ItemCatalogEntry {
  id: number;
  item_name: string;
  item_type: string | null;
  uom: string;
  machine_code: string | null;
  item_group: string | null;
  approval_level: ApprovalLevel;
  /** Comma-separated department codes allowed to request this item — null/empty means every department can. */
  departments: string | null;
  created_at: string;
}

/** One value in the UoM / Machine Code / Item Group / Department option list — see db/schema.ts's optionLists. */
export interface OptionListEntry {
  id: number;
  kind: "item_type" | "uom" | "machine_code" | "item_group" | "department";
  value: string;
  /** Longer-form label shown alongside value — e.g. a Machine Code's full machine name, or a Department's full name. */
  description: string | null;
  created_at: string;
}

/** One page grant on a role: `key` alone means view-only, `can_edit` additionally unlocks that page's actions — see server db/schema.ts's rolePermissions. */
export interface RolePermissionGrant {
  key: string;
  can_edit: boolean;
}

/** An admin-managed role (built-in or custom) and the page permissions it grants — see server db/schema.ts's roles/rolePermissions. */
export interface RoleWithPermissions {
  id: number;
  name: string;
  label: string;
  is_system: boolean;
  created_at: string;
  permissions: RolePermissionGrant[];
}

export interface ItemAudit {
  id: number;
  issuance_number: string;
  /**
   * "OUT" for a stock release, "PARTIAL" for a still-incomplete PR/PO
   * delivery, "FULL" for the delivery that completed the item (in one shot
   * or as the last of several partials).
   */
  transaction_type: "OUT" | "PARTIAL" | "FULL";
  quantity_issued: number;
  remaining_balance: number;
  custodian_name: string;
  issued_at: string;
}

export interface ItemRow {
  id?: number;
  item_name: string;
  quantity: number;
  uom: string;
  remarks: string;
  machine_code?: string;
  delivery_status?: string;
  pr_number?: string;
  pr_status?: string;
  /**
   * Snapshot of delivery_status ("PURCHASE REQUEST" | "URGENT") taken
   * when pr_number was entered, so the Full Delivery history can still tell a
   * PR Number from a GR Number after delivery_status moves on (e.g. to OUT).
   */
  pr_type?: string;
  /**
   * Custodian/admin-entered deadline for a "URGENT" item — shown (and
   * editable) in place of the GR Number field while the item sits at that
   * status. ISO date string (YYYY-MM-DD).
   */
  date_needed?: string | null;
  issuance_number?: string;
  /** Cumulative quantity that has arrived against the request. */
  quantity_delivered?: number;
  /** Cumulative quantity released to the requester. */
  quantity_out?: number;
  /** Server-computed: how much is still to be released. */
  qty_balance?: number;
  /** Transient (client-only): quantity being delivered in this save. */
  quantity_delivered_now?: number;
  /** Transient (client-only): quantity being released in this save. */
  quantity_out_now?: number;
  /**
   * True once Secretary/Supervisor/Manager have corrected a HOLD item's
   * details — the item is still on HOLD, but the UI shows "RELEASE ON HOLD"
   * instead of "ON HOLD" so the custodian knows it's ready for their
   * review/release.
   */
  hold_edited?: boolean;
  audits?: ItemAudit[];
}

export interface ServiceRow {
  id?: number;
  description: string;
  delivery_status?: string;
  pr_number?: string;
  pr_status?: string;
  receiving_report_no?: string;
  /** Name/date of the custodian who last saved receiving_report_no on this line. */
  receiving_report_no_updated_by_name?: string;
  receiving_report_no_updated_at?: string;
  /**
   * True once Secretary/Supervisor/Manager have fixed a "holded" service's
   * description — the service is still Holded, but the UI shows "RELEASE ON
   * HOLD" instead of "ON HOLD" so the custodian knows it's ready for their
   * review/release. See ItemRow.hold_edited.
   */
  hold_edited?: boolean;
}

export interface ItemRequest {
  id: number;
  serial: string;
  created_at: string;
  created_by: string;
  created_by_role?: string;
  requested_by?: string;
  department: string;
  purpose: string;
  remarks: string;
  status: string;
  supervisor_status?: string;
  custodian_status?: string;
  supervisor_name?: string;
  supervisor_approved_by_name?: string;
  supervisor_approved_by_role?: string;
  supervisor_approved_at?: string;
  custodian_name?: string;
  custodian_approved_by_name?: string;
  custodian_approved_by_role?: string;
  custodian_approved_at?: string;
  rejection_comment?: string;
  pr_numbers?: string;
  /** Server-computed: every item has nothing left to release. */
  all_items_served?: boolean;
  /** Server-computed: at least one item's delivery_status is "HOLD" — powers the Held Items page. */
  has_held_item?: boolean;
  /** Server-computed: how many of this request's items are currently on HOLD. */
  held_item_count?: number;
  /** Server-computed: at least one HOLD item has already been fixed by Secretary/Supervisor/Manager (see ItemRow.hold_edited). */
  has_edited_held_item?: boolean;
  attachment?: string;
  attachment_name?: string;
  items?: ItemRow[];
}

/**
 * A value written into an editable request/item field. Covers the text inputs,
 * the numeric quantity inputs, and clearing a numeric input (undefined) — which
 * is meaningfully different from 0 for the "amount moved in this save" fields.
 */
export type FieldValue = string | number | undefined;

export interface ServiceRequest extends Omit<ItemRequest, 'items'> {
  pr_number?: string;
  pr_status?: string;
  services?: ServiceRow[];
  [key: string]: unknown;
}

/**
 * A summary row from either list. The custodian/staff dashboards render the same
 * row component for both tabs, so the shared fields are what they read.
 */
export type RequestRow = ItemRequest | ServiceRequest;

export interface ItemFormData {
  department: string;
  requested_by: string;
  request_type: string;
  purpose: string;
  remarks: string;
}

/** One free-style line item on an Urgent Request — see server/database/
 * schema.ts's urgentRequestItems ARCH note. No item-catalog lookup, unlike
 * ItemRow.item_name. */
export interface UrgentRequestItem {
  id?: number;
  item_description: string;
  quantity?: number;
  uom?: string;
  is_inventoriable: boolean;
  /** Purchaser Dashboard, Phase 2 — set once Purchasing routes the item.
   * null/undefined until then. */
  purchasing_transaction?: "purchase_order" | "payment_request" | null;
  /** Only meaningful once purchasing_transaction = "payment_request" —
   * numeric column, so the API returns it as a string. */
  amount?: string | null;
  /** Delivery self-attestation — Not Inventoriable items only (they skip
   * Custodian/inventory tracking entirely, so the requesting department
   * confirms receipt themselves). Always "pending" for Inventoriable items. */
  delivery_status?: "pending" | "delivered" | "partial_delivered";
  quantity_delivered?: number | null;
  delivered_by?: string | null;
  delivered_by_name?: string | null;
  delivered_at?: string | null;
  /** "New Item List" page — the Item Catalog entry a custodian has
   * registered this Inventoriable item against. Null until registered. */
  catalog_item_name?: string | null;
}

/** Purchaser Dashboard, Phase 3 — the editable F-ACC-003 "Payment Request"
 * form. One per Urgent Request; particulars are derived server-side from
 * that request's items where purchasing_transaction = "payment_request". */
export interface PaymentRequestForm {
  urgent_request_id: number;
  payee?: string | null;
  department?: string | null;
  date?: string | null;
  date_needed?: string | null;
  note?: string | null;
  prepared_by?: string | null;
  checked_by?: string | null;
  approved_by?: string | null;
  particulars: Array<{ id: number; description: string; quantity: number | null; uom: string | null; amount: string | null }>;
  total_amount_due: string;
  /** "Submitted Payment Request" — once true, the Purchaser can no longer
   * edit this form; only AP Officer (or Operations Manager/admin) can. */
  submitted: boolean;
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** "Urgent Item From IRS" page — the same F-ACC-003 form as PaymentRequestForm
 * above, but for a regular Item Request. One per Item Request; particulars
 * are derived server-side from that request's items where
 * purchasing_transaction = "payment_request" — several items on the same
 * request can each be their own Payment Request line. */
export interface ItemPaymentRequestForm {
  item_request_id: number;
  payee?: string | null;
  department?: string | null;
  date?: string | null;
  date_needed?: string | null;
  note?: string | null;
  prepared_by?: string | null;
  checked_by?: string | null;
  approved_by?: string | null;
  particulars: Array<{ id: number; description: string; quantity: number | null; uom: string | null; amount: string | null }>;
  total_amount_due: string;
  /** "Submitted Payment Request" — see PaymentRequestForm's ARCH note. */
  submitted: boolean;
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** "Submitted Payment Request" sidebar page — one row per submitted F-ACC-003
 * form, merged from both PaymentRequestForm (Urgent Request workflow) and
 * ItemPaymentRequestForm ("Urgent Item From IRS") sources. `request_id`
 * keys back into whichever source's own get/save/submit endpoints. */
export interface SubmittedPaymentRequest {
  source: "urgent" | "item";
  request_id: number;
  serial: string;
  department: string | null;
  payee: string | null;
  total_amount_due: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  created_at: string;
}

/** Urgent Request workflow — Supervisor/Manager approval, then Stockroom
 * (the existing Custodian role) review; see server/database/schema.ts's
 * urgentRequests ARCH note. */
export interface UrgentRequest {
  id: number;
  serial: string;
  created_at: string;
  created_by: string;
  /** Powers the "a fellow supervisor can't approve a supervisor-created
   * request" rule — see SupervisorDashboard.tsx's urgent tab. */
  created_by_role?: string;
  requested_by?: string;
  department: string;
  purpose: string;
  remarks?: string;
  /** Defaults the Payment Request Form's own Date Needed field — see
   * getPaymentRequestForm's ARCH note. */
  date_needed?: string;
  supervisor_status: "pending" | "approved" | "rejected";
  supervisor_approved_by?: string;
  /** Resolved display name for the Supervisor/Manager approval. */
  supervisor_approved_by_name?: string;
  supervisor_approved_at?: string;
  /** "not_required" — an all-Not-Inventoriable request has nothing for
   * Stockroom to assign an Item List entry to, so it skips straight to
   * Purchasing once Supervisor/Manager approves (see reviewAsSupervisor's
   * skipsStockroom). No one actually reviewed it, so
   * stockroom_approved_by/_name/_at all stay null in that case. */
  stockroom_status: "pending" | "approved" | "rejected" | "not_required";
  stockroom_approved_by?: string;
  /** Resolved display name for the "Noted by:" stamp. */
  stockroom_approved_by_name?: string;
  stockroom_approved_at?: string;
  rejection_comment?: string;
  items: UrgentRequestItem[];
}

/** Reimbursement Request workflow — Supplier and each item's Amount are
 * entered by the requester up front (unlike the Urgent Request workflow's
 * later Purchaser classification step); see
 * server/database/schema.ts's reimbursementRequests ARCH note. */
export interface ReimbursementRequestItem {
  id?: number;
  item_description: string;
  quantity?: number;
  uom?: string;
  /** Entered at creation, not later — the API returns it as a string. */
  amount: string;
}

/** Supervisor/Manager -> Purchaser -> AP Officer, three formal approval
 * stages (unlike Urgent Request's two) since there's no Stockroom
 * Inventoriable classification step here at all. */
export interface ReimbursementRequest {
  id: number;
  serial: string;
  created_at: string;
  created_by: string;
  /** Powers the "a fellow supervisor can't approve a supervisor-created
   * request" rule. */
  created_by_role?: string;
  requested_by?: string;
  department: string;
  purpose: string;
  remarks?: string;
  date_needed?: string;
  supplier: string;
  supervisor_status: "pending" | "approved" | "rejected";
  supervisor_approved_by?: string;
  supervisor_approved_by_name?: string;
  supervisor_approved_at?: string;
  purchaser_status: "pending" | "approved" | "rejected";
  purchaser_approved_by?: string;
  purchaser_approved_by_name?: string;
  purchaser_approved_at?: string;
  ap_status: "pending" | "approved" | "rejected" | "closed";
  ap_approved_by?: string;
  ap_approved_by_name?: string;
  ap_approved_at?: string;
  /** Set once AP Officer closes the request (ap_status "closed") — the
   * money has actually been disbursed/received, a further step beyond
   * the ap_status approval itself. */
  closed_by?: string;
  closed_at?: string;
  rejection_comment?: string;
  items: ReimbursementRequestItem[];
  /** Sum of every item's amount — computed server-side, not stored. */
  total_cost: string;
}

/** Petty Cash — a simple, independent ledger entry (no approval chain, not
 * tied to any request). Custodian and AP Officer both create/edit PO
 * Number and Total Amount; only AP Officer can set Cash Received (enforced
 * server-side, see petty-cash.service.ts's updatePettyCash). */
export interface PettyCashTransaction {
  id: number;
  /** Generated serial ("PC-2026-000001"), distinct from the free-typed po_number. */
  serial: string;
  po_number: string;
  total_amount: string;
  cash_received: string | null;
  /** When the cash was actually received — set alongside cash_received, same
   * AP-Officer-only restriction. */
  cash_received_at: string | null;
  /** Who actually received the cash — same AP-Officer-only restriction. */
  receiver_name: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceFormData {
  department: string;
  requested_by: string;
  purpose: string;
  remarks: string;
}

export interface UserForm {
  name: string;
  email: string;
  role: string;
  department: string;
  password: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

export type RequestTab = 'item' | 'service';
export type AdminTab = 'item' | 'service' | 'users' | 'roles' | 'departments';

export interface RoleForm {
  name: string;
  label: string;
  permissions: RolePermissionGrant[];
}

export interface RequestDetail {
  serial?: string;
  created_at?: string;
  department?: string;
  requested_by?: string;
  /** UUID of the creator — used to check request ownership (e.g. staff editing their own request). */
  created_by?: string;
  created_by_role?: string;
  purpose?: string;
  remarks?: string;
  status?: string;
  supervisor_status?: string;
  supervisor_name?: string;
  supervisor_approved_by_name?: string;
  supervisor_approved_by_role?: string;
  supervisor_approved_at?: string;
  custodian_status?: string;
  custodian_name?: string;
  custodian_approved_by_name?: string;
  custodian_approved_by_role?: string;
  custodian_approved_at?: string;
  rejection_comment?: string;
  pr_number?: string;
  pr_status?: string;
  /** Name of the custodian who last saved pr_number — service requests only. */
  pr_number_updated_by_name?: string;
  pr_number_updated_at?: string;
  /** Stored filename; presence is what makes the download control appear. */
  attachment?: string;
  /** Original filename, shown to the user and used for the download. */
  attachment_name?: string;
  /** Bytes on disk — shown next to the attachment name/download control. */
  attachment_size?: number;
  items?: ItemRow[];
  services?: ServiceRow[];
  [key: string]: unknown;
}

export interface EditableRequestDetail {
  purpose: string;
  remarks: string;
  items: ItemRow[];
  services: ServiceRow[];
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
