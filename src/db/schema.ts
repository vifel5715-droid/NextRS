import { pgTable, text, integer, uuid, serial, bigserial, index, customType, boolean, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

// node-postgres hands back bytea columns as a Buffer already, so no
// toDriver/fromDriver mapping is needed — a Buffer in is a Buffer out.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull(),
  department: text("department").notNull(),
  created_at: text("created_at").notNull(),
  // Embedded in every session token. Logout and password changes increment
  // it, which revokes every outstanding token for this user (see lib/session.ts).
  session_version: integer("session_version").notNull().default(0),
});

export const itemRequests = pgTable("item_requests", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(),
  department: text("department").notNull(),
  created_by: uuid("created_by").notNull(),
  // Free-text "who this is actually for" — usually just the creator's own
  // name, but a secretary can override it (e.g. "JOHN DOE c/o JANE SMITH")
  // to submit on someone else's behalf. Falls back to created_by's name
  // when null (older rows, or anyone who never overrode it).
  requested_by: text("requested_by"),
  purpose: text("purpose").notNull(),
  remarks: text("remarks"),
  status: text("status").notNull(),
  supervisor_status: text("supervisor_status"),
  supervisor_approved_by: uuid("supervisor_approved_by"),
  supervisor_approved_at: text("supervisor_approved_at"),
  custodian_status: text("custodian_status"),
  custodian_approved_by: uuid("custodian_approved_by"),
  custodian_approved_at: text("custodian_approved_at"),
  rejection_comment: text("rejection_comment"),
  request_type: text("request_type").notNull(),
  // ARCH: `attachment` is the legacy on-disk filename — dev/small-hosting
  // deployments have no persistent disk, so every attachment was lost on
  // every restart/redeploy. New uploads go straight into `attachment_data`
  // (bytea) instead; `attachment` is kept only so rows with legacy file
  // references still resolve. Total
  // attachment bytes are capped — see lib/attachmentStorage.ts.
  attachment: text("attachment"),
  attachment_name: text("attachment_name"),
  attachment_data: bytea("attachment_data"),
  attachment_mime: text("attachment_mime"),
  attachment_size: integer("attachment_size"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("item_requests_department_idx").on(table.department),
  index("item_requests_status_idx").on(table.status),
  index("item_requests_supervisor_status_idx").on(table.supervisor_status),
  index("item_requests_custodian_status_idx").on(table.custodian_status),
  index("item_requests_created_by_idx").on(table.created_by),
]);

export const itemRequestItems = pgTable("item_request_items", {
  id: serial("id").primaryKey(),
  request_id: integer("request_id").notNull().references(() => itemRequests.id, { onDelete: "cascade" }),
  item_name: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  uom: text("uom").notNull(),
  remarks: text("remarks"),
  machine_code: text("machine_code"),
  issuance_number: text("issuance_number"),
  pr_number: text("pr_number"),
  delivery_status: text("delivery_status"),
  /** Cumulative quantity that has ARRIVED against the request (partial deliveries). */
  quantity_delivered: integer("quantity_delivered"),
  /** Cumulative quantity RELEASED to the requester (OUT issuances). */
  quantity_out: integer("quantity_out"),
  qty_balance: integer("qty_balance").notNull().default(0),
  pr_status: text("pr_status"),
  /**
   * Snapshot of delivery_status ("PURCHASE REQUEST" | "URGENT") taken
   * whenever pr_number/pr_status are set for that status. delivery_status itself
   * moves on afterward (e.g. to "OUT"), so without this the Full Delivery
   * history can't tell a PR Number from a GR Number after the fact.
   */
  pr_type: text("pr_type"),
  /**
   * True once Secretary/Supervisor/Manager have corrected a HOLD item's
   * details (name/qty/uom/remarks/machine code) — the item stays on HOLD
   * (the custodian still has to release it), but the UI can tell "just
   * placed on HOLD" apart from "already fixed, awaiting custodian release".
   * Reset to false whenever the item leaves or re-enters HOLD.
   */
  hold_edited: boolean("hold_edited").notNull().default(false),
  /**
   * Required reason for a "HOLD" or "CLOSE" delivery_status — cleared when
   * the item moves to any other status (the Adjustment History entry written
   * at the time keeps the old reason).
   */
  status_reason: text("status_reason"),
  /**
   * Custodian/admin-entered deadline for a "URGENT" item — takes the GR
   * Number field's place in the UI while the item sits at that status,
   * since there is no goods-receipt number yet at that point. ISO date
   * string (YYYY-MM-DD), same shape as PaymentRequestForm.date_needed
   * though this is a separate per-item field, not shared with it.
   */
  date_needed: text("date_needed"),
  /**
   * "Urgent Item From IRS" page — classifies a URGENT item Purchase Order vs
   * Payment Request, same idea as urgentRequestItems.purchasing_transaction
   * but for regular Item Requests. 'purchase_order' | 'payment_request' | null.
   * Each item on a request routes independently — several items on the same
   * request can each be their own Payment Request line.
   */
  purchasing_transaction: text("purchasing_transaction"),
  /** Only meaningful once purchasing_transaction = 'payment_request'. */
  amount: numeric("amount", { precision: 12, scale: 2 }),
  /**
   * "Urgent Item From IRS" page — custodian/admin classification of whether
   * a Payment Request item is real trackable stock (as opposed to a one-off
   * consumable), same idea as urgentRequestItems.is_inventoriable. Feeds the
   * "Pending Item Entry" page: items that are both Payment Request and
   * Inventoriable still need a matching Item Catalog entry (catalog_item_name
   * below) before they can be tracked like any other catalog item.
   */
  is_inventoriable: boolean("is_inventoriable").notNull().default(false),
  /**
   * "Pending Item Entry" page — the Item Catalog entry name the custodian
   * has registered this item against, once entered into the catalog. Free
   * text matched against the catalog client-side (SearchableCombobox), same
   * lightweight convention as machine_code — no FK to item_catalog.
   */
  catalog_item_name: text("catalog_item_name"),
}, (table) => [
  index("item_request_items_request_id_idx").on(table.request_id),
]);

export const itemIssuanceAudits = pgTable("item_issuance_audits", {
  id: serial("id").primaryKey(),
  item_request_item_id: integer("item_request_item_id").notNull().references(() => itemRequestItems.id, { onDelete: "cascade" }),
  request_id: integer("request_id").notNull().references(() => itemRequests.id, { onDelete: "cascade" }),
  issuance_number: text("issuance_number").notNull(),
  /** "OUT" for a stock release, "PARTIAL" for a PR/PO partial delivery. */
  transaction_type: text("transaction_type"),
  quantity_issued: integer("quantity_issued").notNull(),
  remaining_balance: integer("remaining_balance").notNull(),
  custodian_id: uuid("custodian_id").notNull(),
  custodian_name: text("custodian_name").notNull(),
  issued_at: text("issued_at").notNull(),
}, (table) => [
  index("item_issuance_audits_item_request_item_id_idx").on(table.item_request_item_id),
  index("item_issuance_audits_request_id_idx").on(table.request_id),
]);

export const serviceRequests = pgTable("service_requests", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(),
  department: text("department").notNull(),
  created_by: uuid("created_by").notNull(),
  // See item_requests.requested_by for the rationale.
  requested_by: text("requested_by"),
  purpose: text("purpose").notNull(),
  remarks: text("remarks"),
  status: text("status").notNull(),
  supervisor_status: text("supervisor_status"),
  supervisor_approved_by: uuid("supervisor_approved_by"),
  supervisor_approved_at: text("supervisor_approved_at"),
  custodian_status: text("custodian_status"),
  custodian_approved_by: uuid("custodian_approved_by"),
  custodian_approved_at: text("custodian_approved_at"),
  rejection_comment: text("rejection_comment"),
  pr_number: text("pr_number"),
  pr_status: text("pr_status"),
  // Who last saved pr_number, and when — the custodian encoding the PR is not
  // necessarily the one who approved/rejected the request, so this can't be
  // inferred from custodian_approved_by.
  pr_number_updated_by: uuid("pr_number_updated_by"),
  pr_number_updated_at: text("pr_number_updated_at"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("service_requests_department_idx").on(table.department),
  index("service_requests_status_idx").on(table.status),
  index("service_requests_supervisor_status_idx").on(table.supervisor_status),
  index("service_requests_custodian_status_idx").on(table.custodian_status),
  index("service_requests_created_by_idx").on(table.created_by),
]);

export const serviceItems = pgTable("service_items", {
  id: serial("id").primaryKey(),
  service_request_id: integer("service_request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  delivery_status: text("delivery_status"),
  pr_number: text("pr_number"),
  pr_status: text("pr_status"),
  receiving_report_no: text("receiving_report_no"),
  // Who last saved receiving_report_no, and when — same rationale as
  // service_requests.pr_number_updated_by, but per service line since each
  // line can be marked complete (and receipted) independently.
  receiving_report_no_updated_by: uuid("receiving_report_no_updated_by"),
  receiving_report_no_updated_at: text("receiving_report_no_updated_at"),
  /**
   * True once Secretary/Supervisor/Manager have fixed a "holded" service's
   * description — the service stays holded (custodian still has to release
   * it), but the UI can tell "just marked Holded" apart from "already fixed,
   * awaiting custodian release". Same idea as item_request_items.hold_edited.
   * Reset to false whenever delivery_status is explicitly set.
   */
  hold_edited: boolean("hold_edited").notNull().default(false),
}, (table) => [
  index("service_items_service_request_id_idx").on(table.service_request_id),
]);

export const itemStatus = pgTable("item_status", {
  id: serial("id").primaryKey(),
  request_id: integer("request_id").notNull().references(() => itemRequests.id, { onDelete: "cascade" }),
  request_type: text("request_type").notNull(),
  issuance_number: text("issuance_number"),
  pr_number: text("pr_number"),
  delivery_status: text("delivery_status"),
  quantity_delivered: integer("quantity_delivered"),
  status: text("status").notNull(),
  updated_by: uuid("updated_by").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  index("item_status_request_id_idx").on(table.request_id),
]);

export const serviceStatus = pgTable("service_status", {
  id: serial("id").primaryKey(),
  request_id: integer("request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  request_type: text("request_type").notNull(),
  pr_number: text("pr_number"),
  status: text("status").notNull(),
  updated_by: uuid("updated_by").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  index("service_status_request_id_idx").on(table.request_id),
]);

// Audit trail for deleted item/service lines. Deliberately has no FK to its
// parent request/user — the whole point is to outlive them, so a later
// whole-request delete or user removal must not cascade this away.
export const deletionLog = pgTable("deletion_log", {
  id: serial("id").primaryKey(),
  request_type: text("request_type").notNull(), // 'item' | 'service' | 'audit'
  request_id: integer("request_id"),
  request_serial: text("request_serial").notNull(),
  department: text("department").notNull(),
  entity_name: text("entity_name").notNull(), // item_name, service description, or an issuance summary
  quantity: integer("quantity"), // items/audits only
  uom: text("uom"), // items/audits only
  issued_by_name: text("issued_by_name"), // audits only — who originally recorded the issuance being deleted
  reason: text("reason").notNull(),
  deleted_by: uuid("deleted_by").notNull(),
  deleted_at: text("deleted_at").notNull(),
  // Set once recovered — a basic re-add (name/qty/uom only, see
  // deletion-log.controller.ts's recoverDeletionLogEntry), not a full restore.
  recovered_at: text("recovered_at"),
  recovered_by: uuid("recovered_by"),
}, (table) => [
  index("deletion_log_request_type_idx").on(table.request_type),
  index("deletion_log_deleted_at_idx").on(table.deleted_at),
]);

// Audit trail for item field corrections (Item Name/Quantity/UoM/Remarks/
// Machine Code) made after a request's items already exist — the persisted
// counterpart to the Adjustment History view (see
// client/src/components/AdjustmentHistoryModal.tsx). One row per changed
// field, written by lib/adjustmentLog.ts whenever the save request carries a
// non-empty adjustment_remarks. Deliberately no FK to
// item_requests/item_request_items, same as deletion_log, so it outlives them.
export const adjustmentLog = pgTable("adjustment_log", {
  id: serial("id").primaryKey(),
  // Shared by every row written from the same save action (one item can have
  // several fields change in one Save click) — the reference number for that
  // whole adjustment event, distinct from request_serial. See
  // lib/adjustmentLog.ts's nextAdjustmentSerial.
  adjustment_serial: text("adjustment_serial"),
  request_id: integer("request_id"),
  // "item" | "service" — item_requests.id and service_requests.id are
  // independent auto-increment sequences that can collide (e.g. IRS #5 and
  // SRS #5 both existing), and request_id alone can't tell them apart since
  // there's deliberately no FK to either table. Defaults to "item" since
  // every row written before services could adjust anything was one.
  request_type: text("request_type").notNull().default("item"),
  request_serial: text("request_serial").notNull(),
  // The REQUEST's department — used to scope a department-scoped viewer's
  // access (same rationale as deletion_log.department), not shown as-is in
  // the UI. See adjusted_by_department for the department actually displayed.
  department: text("department").notNull(),
  item_label: text("item_label").notNull(), // e.g. "Item #2 — BALL BEARIN"
  field: text("field").notNull(), // "Item Name" | "Quantity" | "UoM" | "Remarks" | "Machine Code"
  before_value: text("before_value"),
  after_value: text("after_value"),
  adjustment_remarks: text("adjustment_remarks").notNull(),
  adjusted_by: uuid("adjusted_by").notNull(),
  adjusted_by_name: text("adjusted_by_name").notNull(),
  adjusted_by_role: text("adjusted_by_role").notNull(),
  // The department of the user who MADE the adjustment — distinct from
  // `department` (the request's own department) since custodian/admin/
  // secretary/supervisor/manager can all adjust a request outside their own
  // department (e.g. the HOLD hand-off on Held Items). This is what the
  // Adjustment History table/print actually display as "Department".
  adjusted_by_department: text("adjusted_by_department").notNull(),
  adjusted_at: text("adjusted_at").notNull(),
}, (table) => [
  index("adjustment_log_request_id_idx").on(table.request_id),
  index("adjustment_log_adjusted_at_idx").on(table.adjusted_at),
  index("adjustment_log_adjustment_serial_idx").on(table.adjustment_serial),
]);

/**
 * A custodian-maintained reference list of known items (name/type/UoM). Purely
 * informational — creating an item request still free-types item_name/uom on
 * item_request_items, this table doesn't feed or constrain that.
 */
export const itemCatalog = pgTable("item_catalog", {
  id: serial("id").primaryKey(),
  item_name: text("item_name").notNull(),
  item_type: text("item_type"),
  uom: text("uom").notNull(),
  // Optional — same option list as item_request_items.machine_code (see the
  // ARCH note on optionLists below). Purely informational here, like item_type/
  // uom: not every catalog item is tied to one specific machine.
  machine_code: text("machine_code"),
  // Optional — mirrors the external accounting system's "Item Group" field
  // (e.g. "CONSUMABLES&UNIFORM", "SPARE PARTS & OTHERS"), its own option
  // list (kind='item_group') seeded from that system's group list. Purely
  // informational here too, same as item_type/uom/machine_code — no link to
  // that system's own Item No., which this catalog has no equivalent for.
  item_group: text("item_group"),
  // Who is authorized to give the supervisor-stage approval on a request
  // containing this item — "MANAGER_ONLY" or "SUPERVISOR_OR_MANAGER". Looked
  // up by item_name at approval time (see status.controller.ts's
  // canApproveAsSupervisor) — the strictest level among a request's items
  // wins. Defaults to the less restrictive tier for pre-existing rows.
  approval_level: text("approval_level").notNull().default("SUPERVISOR_OR_MANAGER"),
  // Comma-separated department codes allowed to request this item (e.g.
  // "ACCTG,QA") — null/empty means every department can. Purely informational
  // like item_type/uom/machine_code: nothing currently blocks a request from
  // free-typing an item name outside its catalog entry's department list.
  departments: text("departments"),
  created_by: uuid("created_by"),
  created_at: text("created_at").notNull(),
});

/**
 * The option lists behind the UoM/Item Group SearchableCombobox fields on the
 * item catalog form and the Machine Code SearchableCombobox field on item
 * request line items. "kind" separates the lists ('item_type' | 'uom' |
 * 'machine_code' | 'item_group' | 'department') in one shared table rather
 * than several near-identical ones. Typing a value
 * that isn't here yet and using it adds it here too (see
 * option-list.controller.ts's createOptionListEntry), so the list grows from
 * actual usage instead of needing a separate admin screen.
 */
export const optionLists = pgTable("option_lists", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  // Longer-form label shown alongside value — e.g. a Machine Code's full
  // machine name/description. Only Machine Code entries populate this today;
  // Item Type/UoM values are self-explanatory and leave it null.
  description: text("description"),
  created_by: uuid("created_by"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("option_lists_kind_idx").on(table.kind),
]);

/**
 * Admin-creatable roles, on top of the 7 built-in ones (staff/secretary/
 * supervisor/manager/custodian/admin/director). `name` is the actual value
 * stored in users.role — kept lowercase, uniqueness enforced case-
 * insensitively via a raw index (see db/indexes.ts) since Drizzle's
 * `.unique()` on text is case-sensitive and wouldn't catch "Staff" vs
 * "staff". `is_system` marks the 7 seeded built-ins: their name/permissions
 * can't be edited or deleted through this table.
 *
 * role_permissions.can_edit gates every write/approve/reject/HOLD/delete/
 * reset route (see middleware/permission.ts's editPermissionMiddleware) —
 * a role, built-in or custom, needs Edit on the matching sidebar page to
 * use that page's write actions. Each built-in role's pre-existing write
 * access was backfilled onto its matching Edit checkbox so nothing changed
 * for them; an admin can now grant or revoke any of it from the Roles
 * screen. Two deliberate exceptions stay hardcoded to literal role names
 * rather than can_edit:
 *   - roles.routes.ts's role CRUD (adminOnly) — role management is the
 *     mechanism that grants every other permission, so it is never itself
 *     permission-gated: a role holding, say, users_management-edit must
 *     not be able to grant itself (or anyone) more permissions than that.
 *   - The finer-grained business logic INSIDE each controller (who can
 *     approve as supervisor, HOLD field-locking specifics, department
 *     scoping — see requestAccess.ts and status.controller.ts) — those
 *     encode approval-chain and ownership semantics a page-level checkbox
 *     can't safely express, and are unrelated to route-level access.
 */
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  is_system: boolean("is_system").notNull().default(false),
  created_at: text("created_at").notNull(),
});

/**
 * Which page-level permission keys (core/security/permissionKeys.ts) a role
 * grants. One row per (role, permission) grant — see roles.controller.ts for
 * how these are written from a role's create/edit checkbox list. `can_edit`
 * distinguishes read-only page access from also being allowed to use that
 * page's write actions — see the ARCH note on `roles` above for the full
 * mapping from each write route to its matching permission key.
 */
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role_id: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permission_key: text("permission_key").notNull(),
  can_edit: boolean("can_edit").notNull().default(false),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("role_permissions_role_id_idx").on(table.role_id),
]);

/**
 * ARCH: Urgent Request workflow, Phase 1 (Stockroom review) — a request
 * header, deliberately kept separate from `itemRequests` rather than bolted
 * onto it. Two things make it a genuinely different shape from a normal item
 * request: items are entered free-style (no item-catalog lookup, see
 * urgentRequestItems below) and there's no dense delivery/PR/HOLD state
 * machine to extend with an unrelated concern. "Stockroom" is the existing
 * Custodian role wearing a different hat for its review step — see
 * requestAccess.ts's isDepartmentScoped/resolveUserDepartment, reused as-is
 * for department scoping here too.
 *
 * The approval chain does mirror itemRequests' Supervisor→Custodian order
 * now: supervisor_status must be "approved" before Stockroom
 * (stockroom_status) can act — see getUrgentRequests'/reviewAsStockroom's
 * gating in urgent-request.service.ts, same pattern as
 * item-request.service.ts's `custodian only sees supervisor-approved
 * requests` filter.
 *
 * Later phases (not built yet) will link an approved, Inventoriable item
 * onward into a real itemRequestItems row once a Purchaser routes it into
 * the existing Purchase Request flow — see the "Roadmap" section of the
 * Urgent Request plan for the full picture.
 */
export const urgentRequests = pgTable("urgent_requests", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(), // "URG-2026-000001"
  department: text("department").notNull(),
  created_by: uuid("created_by").notNull(),
  requested_by: text("requested_by"),
  purpose: text("purpose").notNull(),
  remarks: text("remarks"),
  // When the requester needs this by — optional at submission time, but
  // flows through as the default for the Payment Request Form's own Date
  // Needed field (getPaymentRequestForm) once Purchasing gets to it, rather
  // than that field starting blank every time.
  date_needed: text("date_needed"),
  // "pending" | "approved" | "rejected" — Supervisor/Manager's review
  // decision, evaluated before Stockroom ever sees the request.
  supervisor_status: text("supervisor_status").notNull().default("pending"),
  supervisor_approved_by: uuid("supervisor_approved_by"),
  supervisor_approved_at: text("supervisor_approved_at"),
  // "pending" | "approved" | "rejected" — Stockroom's (Custodian's) review
  // decision, only reachable once supervisor_status is "approved". Every
  // approved request reaches Stockroom now, since Stockroom is the sole
  // classifier of Inventoriable/Not (see urgentRequestItems.is_inventoriable
  // below) — "not_required" is a legacy value from before that (an
  // all-Not-Inventoriable request, back when the requester made that call
  // themselves, skipped Stockroom entirely) and can still appear on old rows.
  stockroom_status: text("stockroom_status").notNull().default("pending"),
  // Who/when approved — resolved to a display name for the "Noted by:" stamp
  // the same way item_requests.supervisor_approved_by already is.
  stockroom_approved_by: uuid("stockroom_approved_by"),
  stockroom_approved_at: text("stockroom_approved_at"),
  // Shared by both stages — a request is only ever declined once, so which
  // stage wrote it is unambiguous from context (supervisor_status vs
  // stockroom_status being "rejected"). Same sharing item_requests uses.
  rejection_comment: text("rejection_comment"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("urgent_requests_department_idx").on(table.department),
  index("urgent_requests_supervisor_status_idx").on(table.supervisor_status),
  index("urgent_requests_stockroom_status_idx").on(table.stockroom_status),
]);

/**
 * Free-style line items on an Urgent Request — a single description field
 * the requester types by hand instead of picking from the item catalog
 * (unlike itemRequestItems.item_name, which the create-request form
 * validates against itemCatalog). `is_inventoriable` is Stockroom's own
 * classification (see urgent-request.service.ts's updateItemInventoriable),
 * not the requester's — every item is created Not Inventoriable and
 * Stockroom sets the real value during their review; it does not yet link to
 * a real item_catalog/itemRequestItems row — that happens in a later phase
 * once a Purchaser routes an approved item onward.
 */
export const urgentRequestItems = pgTable("urgent_request_items", {
  id: serial("id").primaryKey(),
  request_id: integer("request_id").notNull().references(() => urgentRequests.id, { onDelete: "cascade" }),
  item_description: text("item_description").notNull(),
  quantity: integer("quantity"),
  // Free-style like item_description — no item-catalog validation, unlike
  // itemRequestItems.uom (notNull, validated against UOM_OPTIONS client-side
  // there). Optional here since a quick urgent entry may not specify one.
  uom: text("uom"),
  is_inventoriable: boolean("is_inventoriable").notNull().default(false),
  // Purchaser Dashboard, Phase 2 — 'purchase_order' | 'payment_request' | null
  // (not yet routed). Purchase Order exits to the existing Purchase Request
  // flow (out of scope here); Payment Request items become Particulars/Amount
  // lines on that request's paymentRequestForms row (see below).
  purchasing_transaction: text("purchasing_transaction"),
  // Only meaningful once purchasing_transaction = 'payment_request' — the
  // Purchaser fills this in when routing the item, since the original
  // free-style request never captured a price.
  amount: numeric("amount", { precision: 12, scale: 2 }),
  // Delivery self-attestation for Not Inventoriable items only — those skip
  // Custodian/inventory tracking entirely (no Item List entry, no
  // item_issuance_audits ledger — that's Inventoriable items' path, Phase 4
  // of the plan), so the requesting department confirms receipt themselves
  // instead of a custodian. 'pending' | 'delivered' | 'partial_delivered'.
  // A single current snapshot (who/when/how much), not a multi-entry ledger.
  delivery_status: text("delivery_status").notNull().default("pending"),
  quantity_delivered: integer("quantity_delivered"),
  delivered_by: uuid("delivered_by"),
  delivered_at: text("delivered_at"),
  // "New Item List" page — the Item Catalog entry a custodian has registered
  // an Inventoriable item against, same idea as
  // itemRequestItems.catalog_item_name for the IRS workflow. Null until
  // registered.
  catalog_item_name: text("catalog_item_name"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("urgent_request_items_request_id_idx").on(table.request_id),
]);

/**
 * Purchaser Dashboard, Phase 2/3 — the editable F-ACC-003 "Payment Request"
 * form (Staples Food Corp Accounting Dept template). One per Urgent Request
 * (not per item): its Particulars/Amount table is derived at read time from
 * that request's urgentRequestItems rows where purchasing_transaction =
 * 'payment_request', rather than duplicated here — this row only holds the
 * header/signature fields the template adds on top of the item data
 * (Payee/Date Needed/Prepared-Checked-Approved By etc).
 */
export const paymentRequestForms = pgTable("payment_request_forms", {
  id: serial("id").primaryKey(),
  urgent_request_id: integer("urgent_request_id").notNull().unique().references(() => urgentRequests.id, { onDelete: "cascade" }),
  payee: text("payee"),
  department: text("department"),
  date: text("date"),
  date_needed: text("date_needed"),
  note: text("note"),
  prepared_by: text("prepared_by"),
  checked_by: text("checked_by"),
  approved_by: text("approved_by"),
  // Manual override for the Particulars table's computed sum — null means
  // "use the computed total" (getPaymentRequestForm's default). Lets the
  // Purchaser adjust the figure actually printed on the form (e.g. rounding,
  // a negotiated price) without that drifting back to the raw item amounts.
  total_amount_due: numeric("total_amount_due", { precision: 12, scale: 2 }),
  // "Submitted Payment Request" — once the Purchaser submits this form it's
  // locked: savePaymentRequestForm refuses further edits from anyone without
  // ap_officer_dashboard Edit (AP Officer, Operations Manager, Admin), and
  // submitPaymentRequestForm itself refuses to run twice. Same convention on
  // itemPaymentRequestForms below.
  submitted: boolean("submitted").notNull().default(false),
  submitted_by: uuid("submitted_by"),
  submitted_at: text("submitted_at"),
  created_by: uuid("created_by").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  index("payment_request_forms_urgent_request_id_idx").on(table.urgent_request_id),
]);

/**
 * "Urgent Item From IRS" page — the same F-ACC-003 Payment Request form as
 * paymentRequestForms above, but for a regular Item Request instead of an
 * Urgent Request. One per Item Request (not per item): its Particulars/
 * Amount table is derived at read time from that request's itemRequestItems
 * rows where purchasing_transaction = 'payment_request' — several items on
 * the same request can each be their own Payment Request line, same as the
 * urgent_request_items version allows.
 */
export const itemPaymentRequestForms = pgTable("item_payment_request_forms", {
  id: serial("id").primaryKey(),
  item_request_id: integer("item_request_id").notNull().unique().references(() => itemRequests.id, { onDelete: "cascade" }),
  payee: text("payee"),
  department: text("department"),
  date: text("date"),
  date_needed: text("date_needed"),
  note: text("note"),
  prepared_by: text("prepared_by"),
  checked_by: text("checked_by"),
  approved_by: text("approved_by"),
  // See paymentRequestForms.total_amount_due's ARCH note — same override
  // convention for the IRS workflow's copy of this form.
  total_amount_due: numeric("total_amount_due", { precision: 12, scale: 2 }),
  // See paymentRequestForms.submitted's ARCH note — same submit-then-lock
  // convention for the IRS workflow's copy of this form.
  submitted: boolean("submitted").notNull().default(false),
  submitted_by: uuid("submitted_by"),
  submitted_at: text("submitted_at"),
  created_by: uuid("created_by").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  index("item_payment_request_forms_item_request_id_idx").on(table.item_request_id),
]);

/**
 * ARCH: Reimbursement Request workflow — a third request type alongside
 * Item/Service and Urgent, deliberately kept in its own tables rather than
 * bolted onto urgentRequests: unlike an Urgent Request, every item's Amount
 * (and the Supplier) is known up front at submission time — there's no
 * later Purchaser classification step to route items into, and no
 * Inventoriable concept at all (nothing here becomes trackable stock).
 *
 * Three-stage approval chain (Supervisor/Manager -> Purchaser -> AP
 * Officer), one field per stage, each only reachable once the previous one
 * is "approved" — see reimbursement-request.service.ts's reviewAsSupervisor/
 * reviewAsPurchaser/reviewAsAPOfficer for the gating. Purchaser and AP
 * Officer are both unscoped roles (requestAccess.ts's UNSCOPED_ROLES) since
 * they each process every department's requests once it reaches their
 * stage, same as the Urgent Request workflow's Stockroom/Purchaser roles.
 */
export const reimbursementRequests = pgTable("reimbursement_requests", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(), // "RMB-2026-000001"
  department: text("department").notNull(),
  created_by: uuid("created_by").notNull(),
  requested_by: text("requested_by"),
  purpose: text("purpose").notNull(),
  remarks: text("remarks"),
  date_needed: text("date_needed"),
  // Who the requester is being reimbursed for paying — one per request, not
  // per item, since a reimbursement is normally for a single purchase/trip.
  supplier: text("supplier").notNull(),
  attachment_name: text("attachment_name"),
  attachment_data: bytea("attachment_data"),
  attachment_size: integer("attachment_size"),
  // "pending" | "approved" | "rejected" — Supervisor/Manager's review,
  // evaluated first.
  supervisor_status: text("supervisor_status").notNull().default("pending"),
  supervisor_approved_by: uuid("supervisor_approved_by"),
  supervisor_approved_at: text("supervisor_approved_at"),
  // "pending" | "approved" | "rejected" — Purchaser's review, only reachable
  // once supervisor_status is "approved".
  purchaser_status: text("purchaser_status").notNull().default("pending"),
  purchaser_approved_by: uuid("purchaser_approved_by"),
  purchaser_approved_at: text("purchaser_approved_at"),
  // "pending" | "approved" | "rejected" | "closed" — AP Officer's review
  // (final stage), only reachable once purchaser_status is "approved".
  // "closed" is a further transition AP Officer alone can make once
  // "approved", once the reimbursement has actually been fully paid out —
  // see closed_by/closed_at below for who/when, kept separate from
  // ap_approved_by/ap_approved_at so those still record the original
  // approval untouched.
  ap_status: text("ap_status").notNull().default("pending"),
  ap_approved_by: uuid("ap_approved_by"),
  ap_approved_at: text("ap_approved_at"),
  closed_by: uuid("closed_by"),
  closed_at: text("closed_at"),
  // Shared by all three stages — a request is only ever declined once, so
  // which stage wrote it is unambiguous from context (whichever *_status is
  // "rejected"). Same sharing convention as itemRequests/urgentRequests.
  rejection_comment: text("rejection_comment"),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("reimbursement_requests_department_idx").on(table.department),
  index("reimbursement_requests_supervisor_status_idx").on(table.supervisor_status),
  index("reimbursement_requests_purchaser_status_idx").on(table.purchaser_status),
  index("reimbursement_requests_ap_status_idx").on(table.ap_status),
]);

/**
 * Line items on a Reimbursement Request — unlike urgentRequestItems, Amount
 * is entered by the requester up front (see reimbursementRequestSchema),
 * not filled in later by a Purchaser, since the whole point is reimbursing
 * an already-made purchase. Total Cost is always the sum of these, computed
 * at read time (reimbursement-request.service.ts) rather than stored.
 */
export const reimbursementItems = pgTable("reimbursement_items", {
  id: serial("id").primaryKey(),
  request_id: integer("request_id").notNull().references(() => reimbursementRequests.id, { onDelete: "cascade" }),
  item_description: text("item_description").notNull(),
  quantity: integer("quantity"),
  uom: text("uom"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  created_at: text("created_at").notNull(),
}, (table) => [
  index("reimbursement_items_request_id_idx").on(table.request_id),
]);

/**
 * ARCH: Petty Cash — a simple, independent ledger entry (not tied to any
 * Item/Service/Urgent/Reimbursement request, unlike everything else in this
 * schema): PO Number and Total Amount entered by whoever creates it
 * (Custodian or AP Officer), Cash Received filled in separately — see
 * petty-cash.service.ts's updatePettyCash, which enforces AP-Officer-only
 * at the service layer since both roles share the same petty_cash
 * permission and route-level middleware alone can't tell them apart. No
 * approval chain at all — deliberately simpler than every other request
 * type here.
 */
export const pettyCashTransactions = pgTable("petty_cash_transactions", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(), // "CP-2026-000001" (Cash Purchase; older rows may still read PC-)
  po_number: text("po_number").notNull(),
  total_amount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  // Null until AP Officer records it.
  cash_received: numeric("cash_received", { precision: 12, scale: 2 }),
  // When the cash was actually received — set alongside cash_received, same
  // AP-Officer-only restriction (not necessarily "today"; AP Officer picks
  // the date).
  cash_received_at: text("cash_received_at"),
  // Who actually received the cash (not necessarily the requester who
  // logged in — a free-text name) — same AP-Officer-only restriction as
  // cash_received/cash_received_at, recorded at the same time.
  receiver_name: text("receiver_name"),
  // Set when a Custodian (or admin) confirms the purchased goods were
  // delivered — moves the row from Pending to Delivered Cash Purchase. Null
  // means pending, including every row that predates this column.
  delivered_at: text("delivered_at"),
  delivered_by: uuid("delivered_by"),
  // Set when the Custodian marks the cash as received on their side (Cash
  // Status "Received"); null = "Not Received". Separate from AP Officer's
  // cash_received amount.
  cash_confirmed_at: text("cash_confirmed_at"),
  cash_confirmed_by: uuid("cash_confirmed_by"),
  // Receiving Report number for the delivered goods — entered by the
  // Custodian (or admin) only, see setPettyCashRrNumberAction. Null until set.
  rr_number: text("rr_number"),
  created_by: uuid("created_by").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * Failed sign-in attempts, used to throttle password guessing (see
 * server/services/login-throttle.ts). Kept in the database rather than in
 * memory so the limit holds across restarts and multiple app instances.
 * A successful sign-in clears that username's rows; rows older than a day are
 * pruned opportunistically.
 */
export const failedLoginAttempts = pgTable("failed_login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username_key: text("username_key").notNull(),
  ip_address: text("ip_address"),
  attempted_at: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("failed_login_attempts_username_idx").on(table.username_key, table.attempted_at),
  index("failed_login_attempts_ip_idx").on(table.ip_address, table.attempted_at),
  index("failed_login_attempts_attempted_at_idx").on(table.attempted_at),
]);

/**
 * Append-only audit trail of security-relevant and approval events (sign-in,
 * sign-out, approvals/rejections, user and role administration). Written in
 * the same transaction as the change it records where there is one. No FKs,
 * same as deletion_log/adjustment_log, so entries outlive the rows they
 * describe. `details` never holds passwords, hashes or tokens.
 */
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor_id: uuid("actor_id"),
  actor_name: text("actor_name"),
  action: text("action").notNull(),
  entity_type: text("entity_type"),
  entity_id: text("entity_id"),
  department: text("department"),
  details: jsonb("details"),
  ip_address: text("ip_address"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_created_at_idx").on(table.created_at),
  index("audit_logs_entity_idx").on(table.entity_type, table.entity_id),
  index("audit_logs_actor_id_idx").on(table.actor_id),
]);
