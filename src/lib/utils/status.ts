import type React from 'react';

export interface CompositeStatus {
  text: string;
  class: string;
}

// ---------------------------------------------------------------------------
// Constants & Static Styles
// ---------------------------------------------------------------------------
const APPROVED_ROW_STYLE: React.CSSProperties = Object.freeze({
  backgroundColor: '#d4edda',
  borderLeft: '5px solid #28a745',
});

const EMPTY_ROW_STYLE: React.CSSProperties = Object.freeze({});

// Requests created by these roles skip the Supervisor stage
const HIGH_LEVEL_CREATOR_ROLES = new Set(['supervisor', 'manager']);

// Normalize string values safely
const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Display label for a raw status value shown as-is (e.g. supervisor_status/
 * custodian_status badges) — "rejected" reads as "Declined" everywhere in
 * the UI, while the underlying stored value (DB column, API payload,
 * `status === 'rejected'` checks) is left untouched, since renaming that
 * would mean a data migration and touch every comparison in the codebase.
 * Anything else passes through unchanged so existing casing/formatting for
 * approved/pending/etc. isn't affected.
 */
export const formatStatusLabel = (status?: string | null): string => {
  const value = normalize(status);
  if (value === 'rejected') return 'Declined';
  // Urgent Requests, Stockroom stage — an all-Not-Inventoriable request
  // skips Stockroom entirely (see server's reviewAsSupervisor), so its
  // stockroom_status never becomes "approved"/"pending" — this reads
  // clearly as "nothing to review" rather than an unstyled raw value.
  if (value === 'not_required') return 'Not Required';
  // Reimbursement ap_status's 4th value — AP Officer confirmed the money
  // was actually disbursed/received, a step beyond the approval itself.
  if (value === 'closed') return 'Closed';
  return status || '';
};

/**
 * The request's status for a list badge. A Supervisor/Manager decline only
 * sets supervisor_status (the overall `status` stays "pending"), so a
 * rejection at either stage wins over `status`.
 */
export const getEffectiveRequestStatus = (row: {
  status?: string | null;
  supervisor_status?: string | null;
  custodian_status?: string | null;
}): string =>
  normalize(row.supervisor_status) === 'rejected' || normalize(row.custodian_status) === 'rejected'
    ? 'rejected'
    : row.status ?? '';

/**
 * Which approval stage a still-pending request is waiting on — the
 * Supervisor/Manager stage until supervisor_status is approved, then the
 * Custodian stage.
 */
export const getForApprovalLabel = (row: {
  supervisor_status?: unknown;
  custodian_status?: unknown;
} = {}): string =>
  normalize(row.supervisor_status) === 'approved'
    ? 'For Approval (Custodian)'
    : 'For Approval (Supervisor/Manager)';

// ---------------------------------------------------------------------------
// Item Hold / Close
// ---------------------------------------------------------------------------
/** Item delivery statuses that need a reason (item_request_items.status_reason). */
export const REASON_REQUIRED_ITEM_STATUSES: ReadonlySet<string> = new Set(['HOLD', 'CLOSE']);

export const itemStatusNeedsReason = (status?: string | null): boolean =>
  REASON_REQUIRED_ITEM_STATUSES.has((status ?? '').trim().toUpperCase());

/**
 * An item counts toward its request being Complete once it is On Hand (every
 * unit released to the requester) or Closed. An On Hold item does not — it
 * keeps the request open until the custodian moves it to another status.
 */
export const isItemServedOrClosed = (item: {
  quantity: number;
  quantity_out?: number | null;
  delivery_status?: string | null;
}): boolean =>
  (item.quantity_out ?? 0) >= item.quantity || (item.delivery_status ?? '').toUpperCase() === 'CLOSE';

// ---------------------------------------------------------------------------
// Approval Requests vs Pending Requests
// ---------------------------------------------------------------------------
type ApprovalStages = { supervisor_status?: unknown; custodian_status?: unknown };

/**
 * Custodian approval is the last stage of the item/service chain — once it
 * lands the request leaves every "Approval Requests" list and shows in the
 * Pending Item/Service Requests lists instead.
 */
export const isFullyApproved = (row: ApprovalStages): boolean =>
  normalize(row.custodian_status) === 'approved';

/** Still waiting on the Supervisor/Manager stage (not reviewed yet). */
export const isAwaitingSupervisorApproval = (row: ApprovalStages): boolean => {
  const supervisor = normalize(row.supervisor_status);
  return supervisor === '' || supervisor === 'pending';
};

/** Supervisor/Manager approved, Custodian hasn't reviewed yet. */
export const isAwaitingCustodianApproval = (row: ApprovalStages): boolean => {
  const custodian = normalize(row.custodian_status);
  return normalize(row.supervisor_status) === 'approved' && (custodian === '' || custodian === 'pending');
};

// ---------------------------------------------------------------------------
// Badge Helpers
// ---------------------------------------------------------------------------
export const getStatusBadgeClass = (status?: string): string => {
  switch (normalize(status)) {
    case 'pending':
      return 'pending';

    case 'approved':
    case 'completed':
    case 'delivered':
    case 'closed':
      return 'approved';

    case 'rejected':
      return 'rejected';

    case 'in_progress':
      return 'in-progress';

    // Item Hold / Close statuses.
    case 'hold':
      return 'held';
    case 'close':
      return 'approved';

    case 'not_required':
      return 'pending';

    // Passed straight through by getCompositeStatus's `held` class — kept as
    // its own case (rather than falling into the 'pending' default) so a
    // Held request's badge doesn't read the same as an ordinary Pending one.
    case 'held':
    // A service's own delivery_status value ("holded" — see the Services
    // Status <select> in CustodianDashboard/CompleteRequestsPage) — same red
    // styling as an item's HOLD, just a distinct stored value since services
    // otherwise only ever use "pending"/"completed".
    case 'holded':
      return 'held';

    default:
      return 'pending';
  }
};

export const getBsStatusBadgeClass = (status?: string): string => {
  switch (normalize(status)) {
    case 'pending':
      return 'bg-warning';

    case 'approved':
    case 'delivered':
      return 'bg-success';

    case 'completed':
      return 'bg-primary';

    case 'rejected':
      return 'bg-danger';

    case 'in_progress':
      return 'bg-info';

    case 'held':
    case 'holded':
    case 'hold':
      return 'bg-danger';

    case 'close':
      return 'bg-dark';

    // Urgent Requests, Stockroom stage — see formatStatusLabel's note.
    case 'not_required':
      return 'bg-secondary';

    // Reimbursement ap_status's 4th value — a distinct dark badge so a
    // Closed request doesn't read the same as a merely Approved one.
    case 'closed':
      return 'bg-dark';

    default:
      return 'bg-secondary';
  }
};

// ---------------------------------------------------------------------------
// Per-item delivery status (the Items table's own Status column/badge, as
// opposed to the request-level composite above) — the plain, read-only spans
// used on StaffDashboard/SupervisorDashboard/CompleteRequestsPage. The
// editable <select> versions (CustodianDashboard, HeldItemsPage) render this
// same "ON HOLD"/"RELEASE ON HOLD" wording inline instead, since they need it
// on a per-<option> basis rather than a single label. `hold_edited` flips to
// true once Secretary/Supervisor/Manager have fixed the item while it's on
// Hold (see db/schema.ts) — the label switches to "RELEASE ON HOLD" at that
// point so the custodian knows it's ready to be released.
// ---------------------------------------------------------------------------
type DeliveryStatusItem = { delivery_status?: string | null; hold_edited?: boolean } | null | undefined;

const ITEM_STATUS_LABELS: Record<string, string> = {
  OUT: 'ON HAND',
  HOLD: 'ON HOLD',
  CLOSE: 'CLOSED',
};

export const getItemStatusText = (item: DeliveryStatusItem): string =>
  ITEM_STATUS_LABELS[item?.delivery_status ?? ''] ?? (item?.delivery_status || 'pending');

export const getItemStatusBadgeClass = (item: DeliveryStatusItem): string =>
  getStatusBadgeClass(item?.delivery_status ?? undefined);

// ---------------------------------------------------------------------------
// Held services — unlike items, a service request's `services` array is
// already attached on the row itself (see service-request.controller.ts's
// getServiceRequests/getServiceRequestListRow), so no server-computed
// has_held_item/held_item_count equivalent is needed: just read the array
// directly. hold_edited mirrors the item side (see DeliveryStatusItem above)
// — Secretary/Supervisor/Manager fixing a Holded service's description
// doesn't resolve the Hold, just flags it as already handled.
// ---------------------------------------------------------------------------
type HeldServiceRow = { services?: { delivery_status?: string | null; hold_edited?: boolean }[] } | null | undefined;

export const getHeldServiceCount = (row: HeldServiceRow): number =>
  (row?.services || []).filter((s) => s.delivery_status === 'holded').length;

export const hasEditedHeldService = (row: HeldServiceRow): boolean =>
  (row?.services || []).some((s) => s.delivery_status === 'holded' && s.hold_edited);

export const getServiceStatusText = (service: DeliveryStatusItem): string =>
  service?.delivery_status === 'holded'
    ? (service.hold_edited ? 'RELEASE ON HOLD' : 'ON HOLD')
    : (service?.delivery_status || 'pending');

type FinishableService = { delivery_status?: string | null; receiving_report_no?: string | null };

export const SERVICE_FINISH_BLOCKED_MESSAGE =
  'PR Status cannot be set to Finish until every service is Completed and has a Receiving Report No.';

export const canFinishServiceRequest = (services: FinishableService[] | null | undefined): boolean =>
  !!services && services.length > 0 &&
  services.every((s) => s.delivery_status === 'completed' && !!s.receiving_report_no?.trim());

export const getServiceStatusBadgeClass = (service: DeliveryStatusItem): string =>
  service?.delivery_status === 'holded' ? 'held' : getStatusBadgeClass(service?.delivery_status ?? undefined);

// ---------------------------------------------------------------------------
// Composite Status
// ---------------------------------------------------------------------------
export const getCompositeStatus = (
  row: Record<string, unknown> = {}
): CompositeStatus => {
  // Every item has been fully released — that outranks the approval chain,
  // since the request is finished rather than merely approved.
  if (row.all_items_served) {
    return {
      text: 'Complete',
      class: 'approved',
    };
  }

  const supervisorStatus = normalize(row.supervisor_status);
  const managerStatus = normalize(row.manager_status);
  const custodianStatus = normalize(row.custodian_status);
  const status = normalize(row.status);

  // Creator Role
  const creatorRole = normalize(
    row.created_by_role ||
      row.creator_role ||
      row.user_role ||
      (typeof row.created_by === 'object' && row.created_by !== null ? (row.created_by as any).role : undefined)
  );

  // Approver Role
  const approverRole = normalize(
    row.manager_approved_by_role ||
      row.supervisor_approved_by_role ||
      row.approved_by_role ||
      row.approver_role ||
      (typeof row.approved_by === 'object' && row.approved_by !== null ? (row.approved_by as any).role : undefined) ||
      (typeof row.approver === 'object' && row.approver !== null ? (row.approver as any).role : undefined)
  );

  // -------------------------------------------------------
  // Determine Manager Approval
  // -------------------------------------------------------
  const isStaffCreated = creatorRole === 'staff' || creatorRole === 'secretary';

  // Supervisor and Manager share one approval stage, so whoever actually
  // signed it decides the wording — a Manager's approval always reads
  // "Approved (Manager)", whoever created the request.
  const isManagerApproved =
    managerStatus === 'approved' ||
    (supervisorStatus === 'approved' && approverRole === 'manager') ||
    (
      !isStaffCreated &&
      supervisorStatus === 'approved' &&
      HIGH_LEVEL_CREATOR_ROLES.has(creatorRole)
    );

  // -------------------------------------------------------
  // Declined
  // -------------------------------------------------------
  if (custodianStatus === 'rejected') {
    return {
      text: 'Declined (Custodian)',
      class: 'rejected',
    };
  }

  if (managerStatus === 'rejected') {
    return {
      text: 'Declined (Manager)',
      class: 'rejected',
    };
  }

  if (supervisorStatus === 'rejected') {
    return {
      text: approverRole === 'manager' ? 'Declined (Manager)' : 'Declined (Supervisor)',
      class: 'rejected',
    };
  }

  // A Hold on any item overrides the approval-chain wording below — display
  // only, same as CustodianDashboard/SupervisorDashboard's inline version of
  // this: the real supervisor_status/custodian_status are left completely
  // untouched by a Hold (see status.controller.ts's updateRequestItem), so
  // an already-approved request keeps its actual approval underneath, this
  // badge just needs to surface that an item is sitting on Hold right now.
  // Checked after Declined (a rejected request stays Declined even if one of
  // its items still carries a stale HOLD) but before Approved, since that's
  // the wording a Hold is actually meant to mask. See item_request_items.
  // hold_edited / has_held_item / has_edited_held_item.
  if (row.has_held_item) {
    const count = typeof row.held_item_count === 'number' ? row.held_item_count : undefined;
    const label = row.has_edited_held_item ? 'RELEASE ON HOLD' : 'ON HOLD';
    return {
      text: count ? `${label} (${count})` : label,
      class: 'held',
    };
  }

  // Service equivalent — a request whose services array has a "holded" line.
  const heldServiceCount = getHeldServiceCount(row as HeldServiceRow);
  if (heldServiceCount > 0) {
    const serviceLabel = hasEditedHeldService(row as HeldServiceRow) ? 'RELEASE ON HOLD' : 'ON HOLD';
    return {
      text: `${serviceLabel} (${heldServiceCount})`,
      class: 'held',
    };
  }

  // -------------------------------------------------------
  // Approved
  // -------------------------------------------------------

  // Final Approval
  if (custodianStatus === 'approved') {
    return {
      text: 'Approved (Custodian)',
      class: 'approved',
    };
  }

  // Manager Approval
  // Staff approved by Manager
  // Supervisor created request approved by Supervisor (acts as Manager)
  if (isManagerApproved) {
    return {
      text: 'Approved (Manager)',
      class: 'approved',
    };
  }

  // Supervisor Approval
  if (supervisorStatus === 'approved') {
    return {
      text: 'Approved (Supervisor)',
      class: 'approved',
    };
  }

  // -------------------------------------------------------
  // Pending
  // -------------------------------------------------------
  if (
    status === 'pending' ||
    supervisorStatus === 'pending' ||
    managerStatus === 'pending' ||
    custodianStatus === 'pending'
  ) {
    return {
      text: getForApprovalLabel(row),
      class: 'pending',
    };
  }

  if (status === 'rejected') {
    return {
      text: 'Declined',
      class: 'rejected',
    };
  }

  if (status === 'approved') {
    return {
      text: 'Approved',
      class: 'approved',
    };
  }

  if (status === 'not_required') {
    return {
      text: 'Not Required',
      class: 'pending',
    };
  }

  if (status === 'closed') {
    return {
      text: 'Closed',
      class: 'approved',
    };
  }

  // -------------------------------------------------------
  // Default
  // -------------------------------------------------------
  return {
    text: status ? status.toUpperCase() : 'N/A',
    class: getStatusBadgeClass(status),
  };
};

// ---------------------------------------------------------------------------
// Table Row Style
// ---------------------------------------------------------------------------
export const getApprovedRowStyle = (
  row: Record<string, unknown> = {}
): React.CSSProperties => {
  const composite = getCompositeStatus(row);

  return composite.class === 'approved'
    ? APPROVED_ROW_STYLE
    : EMPTY_ROW_STYLE;
};