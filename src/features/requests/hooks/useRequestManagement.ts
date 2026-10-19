import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from '@/lib/next-router';
import { itemRequestAPI, serviceRequestAPI, statusAPI } from '@/lib/api';
import { fetchRequestLists } from "@/lib/api";
import { reviewSupervisorRequestAction as reviewSupervisorRequestResult } from "@/features/approvals/actions/supervisor-review";
import { reviewCustodianRequestAction as reviewCustodianRequestResult } from "@/features/approvals/actions/custodian-review";
import { updateRequestItemAction as updateRequestItemResult } from "@/features/requests/actions/update-request-item";
import { diffItemRow } from '@/features/reports/utils/adjustmentSlip';
import { createLogger } from '@/lib/client-logger';
import { makeRequestKey } from "@/lib/utils/requestKey";
import { useRequestsChanged, type RequestChangedPayload } from '@/hooks/useRequestsChanged';
import { upsertById, removeById } from "@/lib/utils/reconcileRequests";
import { debounceByKey } from '@/lib/utils/debounce';
import { getErrorMessage } from '@/lib/utils/errorMessage';
import type {
  ItemRequest,
  ServiceRequest,
  RequestTab,
  RequestRow,
  RequestDetail,
  ServiceRow,
  ItemRow,
  ItemAudit,
  FieldValue,
} from '@/types';
import { throwOnError } from "@/lib/utils/actionResult";
import { getItemStatusText, itemStatusNeedsReason, canFinishServiceRequest, SERVICE_FINISH_BLOCKED_MESSAGE } from "@/lib/utils/status";

const updateRequestItemAction = throwOnError(updateRequestItemResult);
const reviewSupervisorRequestAction = throwOnError(reviewSupervisorRequestResult);
const reviewCustodianRequestAction = throwOnError(reviewCustodianRequestResult);

const log = createLogger("useRequestManagement");


// Item fields an Adjustment History entry is logged for when changed on save —
// see handleSaveItem/updateItemField below.
const ADJUSTMENT_TRACKED_FIELDS = new Set(['item_name', 'quantity', 'uom', 'remarks', 'machine_code']);

// Rows still awaiting action float to the top — a stable partition (Array.sort
// is spec-guaranteed stable), so Pending rows keep whatever relative order
// they already had, and so does everything else; only the two groups swap
// position relative to each other. Used by both the custodian and admin
// Pending Requests screens, since they share this hook.
//
// Keyed off row.status rather than getCompositeStatus: the visible badge in
// the list (CustodianDashboard's renderSummaryRow) reads row.status directly,
// and that field stays 'pending' until *this* approver acts even after an
// earlier stage (e.g. Supervisor) has approved — getCompositeStatus would
// already call such a row 'approved', disagreeing with its own badge.
const isPendingRow = (row: Record<string, unknown>) =>
  typeof row.status === 'string' && row.status.trim().toLowerCase() === 'pending';
const withPendingFirst = <T extends Record<string, unknown>>(rows: T[]): T[] =>
  [...rows].sort((a, b) => Number(isPendingRow(b)) - Number(isPendingRow(a)));

const isSupervisorApproved = (row: { supervisor_status?: string }) =>
  row.supervisor_status?.trim().toLowerCase() === 'approved';

export const useRequestManagement = (
  options: { supervisorApprovedOnly?: boolean; initialTab?: RequestTab } = {}
) => {
  const { supervisorApprovedOnly = false, initialTab = 'item' } = options;
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<RequestTab>(initialTab);
  const [itemRequests, setItemRequests] = useState<ItemRequest[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>(
    searchParams.get('department') || 'all'
  );
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newStatus, setNewStatus] = useState('approved');
  const [rejectionComment, setRejectionComment] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [requestDetails, setRequestDetails] = useState<Map<string, RequestDetail>>(new Map());
  const [editableServices, setEditableServices] = useState<Map<number, ServiceRow[]>>(new Map());
  // Tracks unsaved Purpose/Remarks edits (request-level, not per item row).
  const [hasItemChanges, setHasItemChanges] = useState<Set<number>>(new Set());
  const [hasServiceChanges, setHasServiceChanges] = useState<Set<number>>(new Set());
  // Which item rows (by item id) have unsaved field edits — drives each
  // row's own Save button rather than one button for the whole table.
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<number>>(new Set());
  // Which item rows have unsaved edits specifically to the Item Name field —
  // narrower than dirtyItemIds on purpose. CustodianDashboard.tsx's
  // canEditItemName needs to know "is this row's name itself being typed
  // right now" (so a live keystroke that happens to match the catalog
  // doesn't yank the input away mid-edit), not "was any field on this row
  // touched" — editing Quantity, Machine Code, or PR Status must never
  // silently unlock a name that's otherwise catalog-locked.
  const [itemNameDirtyIds, setItemNameDirtyIds] = useState<Set<number>>(new Set());
  // Pre-edit snapshot of each dirty item row (by item id), captured the moment
  // an Adjustment History-tracked field is first touched — the Before side of
  // the Adjustment Remarks prompt/history entry on save. See handleSaveItem.
  const [itemSnapshots, setItemSnapshots] = useState<Map<number, ItemRow>>(new Map());
  // Service equivalent of itemSnapshots — a service only ever tracks
  // Description (see status.controller.ts's SERVICE_ADJUSTMENT_TRACKED_FIELDS
  // / adjustmentLog.ts's logServiceAdjustments), so this only needs to record
  // the pre-edit description, keyed by service id.
  const [serviceSnapshots, setServiceSnapshots] = useState<Map<number, ServiceRow>>(new Map());
  // Which request(s) currently have a "Save All" in flight — keyed by
  // request id (not a single boolean) so saving one request's selected rows
  // doesn't disable the button on a different expanded request.
  const [savingAllRequestIds, setSavingAllRequestIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItemRequests = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const matched = !searchQuery.trim() ? itemRequests : itemRequests.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q) ||
      (row.pr_numbers?.toLowerCase() || '').includes(q)
    );
    return withPendingFirst(matched as unknown as Record<string, unknown>[]) as unknown as ItemRequest[];
  }, [itemRequests, searchQuery]);

  const filteredServiceRequests = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const matched = !searchQuery.trim() ? serviceRequests : serviceRequests.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q)
    );
    return withPendingFirst(matched as unknown as Record<string, unknown>[]) as unknown as ServiceRequest[];
  }, [serviceRequests, searchQuery]);

  // useCallback matters here beyond the usual memoization win: callers
  // (useCustodianRequests, useAdminData) put these functions straight into a
  // useEffect dependency array. An unmemoized function is a new reference
  // every render, which reruns the effect, which calls this, which sets
  // state, which renders — an infinite fetch loop with no natural backoff.
  const loadItemRequests = useCallback(async () => {
    log.info("Loading item requests");
    try {
      const res = await fetchRequestLists("all");
      // Fully-served requests live on the Complete Requests page instead —
      // see useCompleteRequestsManagement.ts — so they are dropped here rather than shown twice.
      const data = res.itemRequests.filter((request) =>
        !request.all_items_served &&
        (!supervisorApprovedOnly || isSupervisorApproved(request))
      );
      log.info("Item requests loaded:", data.length, "records");
      setItemRequests(data);
    } catch (error) {
      log.error("Failed to load item requests:", error);
      console.error('Error loading item requests:', error);
    }
  }, [supervisorApprovedOnly]);

  const loadServiceRequests = useCallback(async () => {
    log.info("Loading service requests");
    try {
      const res = await fetchRequestLists("all");
      // Finished PRs live on the Complete Requests page instead — see
      // useCompleteRequestsManagement.ts — so they are dropped here rather than shown twice.
      const data = res.serviceRequests.filter((request) =>
        request.pr_status !== "finish" &&
        (!supervisorApprovedOnly || isSupervisorApproved(request))
      );
      log.info("Service requests loaded:", data.length, "records");
      setServiceRequests(data);
    } catch (error) {
      log.error("Failed to load service requests:", error);
      console.error('Error loading service requests:', error);
    }
  }, [supervisorApprovedOnly]);

  const reloadCurrentTab = () => {
    if (activeTab === 'item') loadItemRequests();
    else loadServiceRequests();
  };

  // ARCH: state reconciliation. The server pushes the changed row already
  // projected into list shape (RequestChangedPayload.data), so a
  // create/update patches straight into local state — no refetch of the
  // whole list. Only an already-open detail panel still needs a fetch
  // (list rows don't carry the items/services/approver-name detail shape).
  const requestDetailsRef = useRef(requestDetails);
  useEffect(() => { requestDetailsRef.current = requestDetails; }, [requestDetails]);
  // Read inside the refetch below so a background refresh (triggered by
  // someone else's change to this same request — e.g. the Held Items
  // hand-off, where custodian and secretary can now both have the same
  // request open at once) never clobbers a row the current user is
  // mid-editing but hasn't saved yet.
  const dirtyItemIdsRef = useRef(dirtyItemIds);
  useEffect(() => { dirtyItemIdsRef.current = dirtyItemIds; }, [dirtyItemIds]);

  // Debounced per request key so a burst of item-level events for the same
  // open request (e.g. batch-saving several rows) collapses into one fetch.
  const debouncedDetailRefetch = useRef(
    debounceByKey((key: string, type: RequestTab, id: number) => {
      const fetcher = type === 'item' ? itemRequestAPI.getById(id) : serviceRequestAPI.getById(id);
      fetcher.then(res => setRequestDetails(prev => {
        const freshData = res.data;
        const existing = prev.get(key);
        if (type === 'item' && existing?.items && freshData.items && dirtyItemIdsRef.current.size > 0) {
          freshData.items = freshData.items.map((freshItem: ItemRow) => {
            if (freshItem.id !== undefined && dirtyItemIdsRef.current.has(freshItem.id)) {
              const localItem = existing.items?.find((i: ItemRow) => i.id === freshItem.id);
              return localItem || freshItem;
            }
            return freshItem;
          });
        }
        return new Map(prev).set(key, freshData);
      })).catch(() => {});
    }, 400)
  ).current;

  // Realtime events carry ids only (no row data), so the affected list is
  // refetched — debounced per list so a burst of saves is one reload.
  const listLoadersRef = useRef({ loadItemRequests, loadServiceRequests });
  useEffect(() => { listLoadersRef.current = { loadItemRequests, loadServiceRequests }; }, [loadItemRequests, loadServiceRequests]);
  const debouncedListReload = useRef(
    debounceByKey((key: string) => {
      void (key === "item" ? listLoadersRef.current.loadItemRequests() : listLoadersRef.current.loadServiceRequests());
    }, 500)
  ).current;

  const handleRequestChanged = useCallback((payload: RequestChangedPayload) => {
    // This hook only manages item/service request lists — an Urgent Request
    // or Reimbursement Request change (separate workflows) is handled by
    // useUrgentRequests.ts/useReimbursementRequests.ts instead.
    if (payload.type === 'urgent' || payload.type === 'reimbursement') return;
    const key = makeRequestKey(payload.type, payload.id);

    if (payload.action === 'deleted') {
      if (payload.type === 'item') setItemRequests(prev => removeById(prev, payload.id));
      else setServiceRequests(prev => removeById(prev, payload.id));
      setRequestDetails(prev => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
      setExpandedRows(prev => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });
      return;
    }

    if (payload.data) {
      // Keep custodian initial loads and realtime updates on the same
      // supervisor/manager approval gate.
      const isApprovedForThisList =
        !supervisorApprovedOnly ||
        isSupervisorApproved(payload.data as { supervisor_status?: string });
      if (payload.type === 'item') {
        // A request that just became fully served moves to the Complete
        // Requests page instead — drop it here rather than upsert it back in.
        const shouldShow = isApprovedForThisList && !(payload.data as ItemRequest).all_items_served;
        setItemRequests(prev => shouldShow ? upsertById(prev, payload.data!) : removeById(prev, payload.id));
      } else {
        // A service request whose PR just got marked "finish" moves to the
        // Complete Requests page instead — drop it here rather than upsert it back in.
        const shouldShow = isApprovedForThisList && (payload.data as ServiceRequest).pr_status !== "finish";
        setServiceRequests(prev => shouldShow ? upsertById(prev, payload.data!) : removeById(prev, payload.id));
      }
    } else {
      debouncedListReload(payload.type);
    }

    // Keep an already-open detail panel live instead of showing stale approval state.
    if (requestDetailsRef.current.has(key)) {
      debouncedDetailRefetch(key, payload.type, payload.id);
    }
  }, [debouncedDetailRefetch, debouncedListReload, supervisorApprovedOnly]);

  useRequestsChanged(handleRequestChanged);

  const handleRowClick = useCallback(async (row: RequestRow) => {
    const key = makeRequestKey(activeTab, row.id);
    const newExpandedRows = new Set<string>();
    if (!expandedRows.has(key)) {
      newExpandedRows.add(key);
      if (!requestDetails.has(key)) {
        try {
          const response = await (
            activeTab === 'item' ? itemRequestAPI.getById(row.id) : serviceRequestAPI.getById(row.id)
          );
          setRequestDetails(prev => new Map(prev).set(key, response.data));
        } catch (error) {
          console.error('Error fetching request details:', error);
        }
      }
    }
    setExpandedRows(newExpandedRows);
  }, [activeTab, expandedRows, requestDetails]);

  // Deep link from Pending Items: ?request=<id> expands that request once the
  // list has loaded. Runs once per id so the row stays collapsible afterwards.
  const deepLinkedRequest = searchParams.get('request');
  const handledDeepLink = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkedRequest || handledDeepLink.current === deepLinkedRequest) return;
    const row = itemRequests.find(r => String(r.id) === deepLinkedRequest);
    if (!row) return;
    handledDeepLink.current = deepLinkedRequest;
    const timer = window.setTimeout(() => {
      setActiveTab('item');
      void handleRowClick(row);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [deepLinkedRequest, itemRequests, handleRowClick]);

  const handleStatusClick = (row: RequestRow) => {
    setSelectedRequest(row);
    setNewStatus('approved');
    setShowModal(true);
  };

  const handleStatusUpdate = async () => {
    if (!selectedRequest) return;
    log.info("Updating request #" + selectedRequest.id, `to '${newStatus}' (${activeTab})`);
    try {
      await reviewCustodianRequestAction({
        type: activeTab,
        id: selectedRequest.id,
        decision: newStatus === "rejected" ? "rejected" : "approved",
        rejectionComment: newStatus === "rejected" ? rejectionComment.toUpperCase() : undefined,
      });
      log.info("Request #" + selectedRequest.id, "updated to", newStatus);
      setShowModal(false);
      setRejectionComment('');
      // Refresh the detail panel in place rather than collapsing it — the
      // custodian just approved/rejected this IRS/SRS and likely wants to
      // keep working on it (e.g. setting item delivery status) right after.
      const statusKey = makeRequestKey(activeTab, selectedRequest.id);
      try {
        const response = await (
          activeTab === 'item' ? itemRequestAPI.getById(selectedRequest.id) : serviceRequestAPI.getById(selectedRequest.id)
        );
        setRequestDetails(prev => new Map(prev).set(statusKey, response.data));
      } catch (error) {
        log.error("Failed to refresh details for request #" + selectedRequest.id, error);
      }
      reloadCurrentTab();
    } catch (error: unknown) {
      log.error("Failed to update status for request #" + selectedRequest.id, error);
      alert(error instanceof Error ? error.message : "Failed to update request status.");
    }
  };

  // Purpose/Remarks are edited in the same detail panel as the item rows but
  // saved independently of them now — each item row gets its own Save button
  // (see handleSaveItem) rather than one button committing every edited row
  // (and these two fields) at once.
  const handleSaveRequestInfo = async (requestId: number) => {
    const details = requestDetails.get(makeRequestKey('item', requestId));
    if (!details) return;
    try {
      await itemRequestAPI.update(requestId, { purpose: details.purpose, remarks: details.remarks });
      const refreshed = await itemRequestAPI.getById(requestId);
      setRequestDetails(prev => new Map(prev).set(makeRequestKey('item', requestId), refreshed.data));
      log.info("Request info saved for request #" + requestId);
      alert('Request info saved successfully!');
      setHasItemChanges(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    } catch (error: unknown) {
      const reason = getErrorMessage(error, 'Failed to save request info');
      log.error("Failed to save request info for request #" + requestId, reason);
      alert('Failed to save request info: ' + reason);
    }
  };

  const validateItemForSave = (item: ItemRow): string | null => {
    if (!item.item_name?.trim()) return 'Item Name cannot be blank';
    // PR Number/PR Status only render once a Purchase/Payment Request status
    // is picked (see the Details column), so they are easy to leave blank —
    // catch that before hitting the API rather than saving an incomplete row.
    // The number itself (PR Number for Purchase Request,  for
    // Payment Request) is only mandatory for Purchase Request — Payment
    // Request only requires a status.
    if (item.delivery_status === 'PURCHASE REQUEST' && !item.pr_number?.trim()) {
      return 'PR Number is required';
    }
    if (item.delivery_status === 'URGENT' && !item.pr_status) {
      return 'Status is required';
    }
    if (itemStatusNeedsReason(item.delivery_status) && !item.status_reason?.trim()) {
      return `A reason is required to mark this item as ${getItemStatusText(item)}`;
    }
    return null;
  };

  const buildItemSavePayload = (item: ItemRow) => {
    const data: Record<string, string | number | undefined> = {
      item_name: item.item_name,
      quantity: item.quantity,
      uom: item.uom,
      remarks: item.remarks,
      machine_code: item.machine_code,
      issuance_number: item.issuance_number,
      pr_number: item.pr_number,
      date_needed: item.date_needed ?? undefined,
      delivery_status: item.delivery_status,
      status_reason: item.status_reason ?? undefined,
      pr_status: item.pr_status,
    };
    // Both are the amount moved in *this* save; the API adds each to its
    // own running total. Delivery (goods arriving) and release (goods going
    // out to the requester) are tracked separately, so send them separately
    // and only when the custodian actually entered one.
    //
    // "Delivered" (full, as opposed to "Delivered Partial") has no
    // quantity input of its own — by definition it means everything
    // outstanding just arrived, so an untouched full-Delivered row
    // defaults to the remainder. This is also what makes the item's
    // "received by / date" show up at all: that comes from the audit
    // row created when quantity_delivered actually moves (see
    // computeIssuance in status/issuance.ts), and picking "Delivered"
    // from the dropdown alone never used to move it. Guarded on
    // outstandingToDeliver > 0 so a request already fully delivered
    // doesn't get re-audited on every unrelated save (e.g. editing
    // remarks). "Delivered Partial" is deliberately NOT defaulted —
    // a partial arrival can recur, and auto-filling the full
    // remainder would misrecord it as complete.
    const outstandingToDeliver = Math.max(0, (item.quantity || 0) - (item.quantity_delivered || 0));
    const deliveredNow = item.quantity_delivered_now ?? (
      item.delivery_status === 'URGENT' && item.pr_status === 'DELIVERED' && outstandingToDeliver > 0 ? outstandingToDeliver : undefined
    );
    if (deliveredNow !== undefined && deliveredNow !== null) {
      data.quantity_delivered = deliveredNow;
    }
    // Only release the quantity the custodian explicitly entered. Defaulting
    // an untouched Qty Out field to the full remainder made a status-only save
    // release all pending stock.
    const releasedNow = item.quantity_out_now;
    if (releasedNow !== undefined && releasedNow !== null) {
      data.quantity_out = releasedNow;
    }
    return data;
  };

  // Saves exactly one item row — the per-row Save button (or Enter inside
  // that row) — rather than every edited row in the request at once, so
  // editing one row can never accidentally also commit another row's
  // in-progress edit.
  const handleSaveItem = async (requestId: number, itemId: number) => {
    const details = requestDetails.get(makeRequestKey('item', requestId));
    const item = details?.items?.find((i: ItemRow) => i.id === itemId);
    if (!item) return;

    const validationError = validateItemForSave(item);
    if (validationError) {
      alert(validationError);
      return;
    }

    // Adjustment History: only gates/logs when a tracked field actually
    // changed from the pre-edit snapshot — untouched saves (e.g. only a status
    // or PR field changed) don't prompt. Remarks are collected up front
    // (cancelling aborts the save, same as the reject-reason prompt elsewhere
    // in this hook) and sent along with the save so the server can log the
    // entry — see status.controller.ts's updateRequestItem / lib/adjustmentLog.ts.
    const snapshot = itemSnapshots.get(itemId);
    const itemIndex = details?.items?.findIndex((i: ItemRow) => i.id === itemId) ?? -1;
    const changes = snapshot
      ? diffItemRow(snapshot, item, `Item #${itemIndex + 1} — ${item.item_name || 'N/A'}`)
      : [];
    let adjustmentRemarks = '';
    if (changes.length > 0) {
      const enteredRemarks = window.prompt('Enter Adjustment Remarks for this change:');
      if (enteredRemarks === null) return;
      adjustmentRemarks = enteredRemarks;
    }

    log.info("Saving item #" + itemId, "for request #" + requestId);
    try {
      if (!item.id) {
        alert('Item ID is missing');
        return;
      }
      const savePayload = buildItemSavePayload(item);
      if (changes.length > 0) savePayload.adjustment_remarks = adjustmentRemarks;
      await updateRequestItemAction(item.id, savePayload);
      const refreshed = await itemRequestAPI.getById(requestId);
      setRequestDetails(prev => new Map(prev).set(makeRequestKey('item', requestId), refreshed.data));
      log.info("Item #" + itemId, "saved");
      setDirtyItemIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setItemNameDirtyIds(prev => {
        if (!prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setItemSnapshots(prev => {
        if (!prev.has(itemId)) return prev;
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
    } catch (error: unknown) {
      // Surface the API's message — the item endpoint rejects with specific
      // reasons ("Issuance Number is required...", "Issued quantity cannot
      // exceed...") that the custodian needs in order to fix the input.
      const reason = getErrorMessage(error, 'Failed to save item');
      log.error("Failed to save item #" + itemId, reason);
      alert('Failed to save item: ' + reason);
    }
  };

  // Saves every row in `itemIds` that has unsaved edits, in one action — the
  // "Save All" button next to the checkbox selection bar (only rows that are
  // both checked and dirty are ever passed in here; see CustodianDashboard.tsx).
  // Validates every row up front, before any network call, so a bad row
  // blocks the whole batch rather than partially saving; asks for a single
  // shared Adjustment Remarks entry covering every row that needs one
  // (instead of one prompt per row); then fires one PUT per row in parallel —
  // there is no bulk-save endpoint server-side, same constraint
  // handleSaveServiceUpdates below already works around. Rows that fail stay
  // dirty and are named in a follow-up alert; rows that succeed clear
  // immediately and the request is re-fetched once.
  const handleSaveAllItems = async (requestId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;
    const details = requestDetails.get(makeRequestKey('item', requestId));
    const items = itemIds
      .map((id) => details?.items?.find((i: ItemRow) => i.id === id))
      .filter((i): i is ItemRow => !!i);
    if (items.length === 0) return;

    const validationErrors: string[] = [];
    items.forEach((item, index) => {
      const error = validateItemForSave(item);
      if (error) validationErrors.push(`Item #${index + 1} — ${item.item_name || 'N/A'}: ${error}`);
    });
    if (validationErrors.length > 0) {
      alert('Fix the following before saving:\n\n' + validationErrors.join('\n'));
      return;
    }

    // One shared prompt for the whole batch, only if at least one row
    // actually has a tracked-field change — same rule handleSaveItem uses
    // per row, just asked once instead of once per row.
    const itemsNeedingRemarks = items.filter((item) => {
      const snapshot = item.id !== undefined ? itemSnapshots.get(item.id) : undefined;
      return snapshot ? diffItemRow(snapshot, item, '').length > 0 : false;
    });
    let sharedRemarks = '';
    if (itemsNeedingRemarks.length > 0) {
      const entered = window.prompt('Enter Adjustment Remarks for these changes:');
      if (entered === null) return;
      sharedRemarks = entered;
    }

    setSavingAllRequestIds(prev => new Set(prev).add(requestId));
    log.info("Saving all selected items for request #" + requestId, "-", items.length, "row(s)");

    const results = await Promise.allSettled(
      items.map((item) => {
        const savePayload = buildItemSavePayload(item);
        if (itemsNeedingRemarks.includes(item)) savePayload.adjustment_remarks = sharedRemarks;
        return updateRequestItemAction(item.id!, savePayload);
      })
    );

    const succeededIds = new Set<number>();
    const failures: string[] = [];
    results.forEach((result, index) => {
      const item = items[index];
      if (result.status === 'fulfilled') {
        if (item.id !== undefined) succeededIds.add(item.id);
      } else {
        failures.push(`${item.item_name || 'N/A'}: ${getErrorMessage(result.reason, 'Failed to save item')}`);
      }
    });

    if (succeededIds.size > 0) {
      const refreshed = await itemRequestAPI.getById(requestId);
      setRequestDetails(prev => new Map(prev).set(makeRequestKey('item', requestId), refreshed.data));
      setDirtyItemIds(prev => {
        const next = new Set(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
      setItemNameDirtyIds(prev => {
        if (![...succeededIds].some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
      setItemSnapshots(prev => {
        if (![...succeededIds].some((id) => prev.has(id))) return prev;
        const next = new Map(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
    }

    setSavingAllRequestIds(prev => {
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });

    if (failures.length > 0) {
      alert(`${succeededIds.size} of ${items.length} row(s) saved. The rest failed:\n\n` + failures.join('\n'));
    }
  };

  const handleSaveServiceUpdates = async (requestId: number) => {
    const details = requestDetails.get(makeRequestKey('service', requestId));
    if (!details) return;
    if (details.pr_status === 'finish' && !canFinishServiceRequest(details.services)) {
      alert(SERVICE_FINISH_BLOCKED_MESSAGE);
      return;
    }

    // Adjustment History: one shared prompt covering every service line whose
    // Description actually changed from its pre-edit snapshot — same rule
    // handleSaveAllItems uses for a batch of items. Cancelling aborts the
    // whole save, same as everywhere else this prompt appears.
    const servicesNeedingRemarks = new Set(
      (details.services || [])
        .filter((service) => {
          const snapshot = service.id !== undefined ? serviceSnapshots.get(service.id) : undefined;
          return snapshot ? (snapshot.description || '') !== (service.description || '') : false;
        })
        .map((service) => service.id)
    );
    let sharedRemarks = '';
    if (servicesNeedingRemarks.size > 0) {
      const entered = window.prompt('Enter Adjustment Remarks for this change:');
      if (entered === null) return;
      sharedRemarks = entered;
    }

    try {
      // Lines first: the server only accepts a Finish once the saved lines qualify.
      if (details.services) {
        await Promise.all(
          details.services.map((service) => {
            const payload: Record<string, unknown> = {
              description: service.description,
              delivery_status: service.delivery_status,
              receiving_report_no: service.receiving_report_no,
            };
            if (servicesNeedingRemarks.has(service.id)) payload.adjustment_remarks = sharedRemarks;
            return statusAPI.updateServiceItem(service.id!, payload);
          })
        );
      }
      await serviceRequestAPI.update(requestId, {
        pr_number: details.pr_number,
        pr_status: details.pr_status,
        purpose: details.purpose,
        remarks: details.remarks,
      });
      // Re-fetch rather than trust the locally-edited copy — the server can
      // override what was sent (e.g. clearing an existing receiving_report_no
      // forces delivery_status/pr_status back to pending regardless of what
      // the dropdowns still showed at save time).
      const key = makeRequestKey('service', requestId);
      const refreshed = await serviceRequestAPI.getById(requestId);
      setRequestDetails(prev => new Map(prev).set(key, refreshed.data));
      setEditableServices(prev => {
        if (!prev.has(requestId)) return prev;
        const next = new Map(prev);
        next.delete(requestId);
        return next;
      });
      setServiceSnapshots(prev => {
        if (servicesNeedingRemarks.size === 0) return prev;
        const next = new Map(prev);
        servicesNeedingRemarks.forEach((id) => { if (id !== undefined) next.delete(id); });
        return next;
      });
      alert('Service updates saved successfully!');
      setHasServiceChanges(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    } catch (error: unknown) {
      const reason = getErrorMessage(error, 'Failed to save service updates');
      log.error('Failed to save service updates for request #' + requestId, reason);
      alert('Failed to save service updates: ' + reason);
    }
  };

  const handleSupervisorAction = async (row: RequestRow, action: 'approve' | 'reject') => {
    if (action === 'approve') {
      if (!confirm('Are you sure you want to approve this request as supervisor?')) return;
      try {
        await reviewSupervisorRequestAction({ type: activeTab, id: row.id, decision: "approved" });
        const approveKey = makeRequestKey(activeTab, row.id);
        setRequestDetails(prev => { const next = new Map(prev); next.delete(approveKey); return next; });
        setExpandedRows(prev => { const next = new Set(prev); next.delete(approveKey); return next; });
        reloadCurrentTab();
      } catch (error: unknown) {
        const reason = getErrorMessage(error, 'Unable to approve request');
        log.error("Failed to approve (supervisor) request #" + row.id, reason);
        alert('Failed to approve request: ' + reason);
      }
    } else {
      const comment = window.prompt('Enter reason for declining:');
      if (comment === null) return;
      try {
        await reviewSupervisorRequestAction({
          type: activeTab,
          id: row.id,
          decision: "rejected",
          rejectionComment: comment.toUpperCase(),
        });
        const rejectKey = makeRequestKey(activeTab, row.id);
        setRequestDetails(prev => { const next = new Map(prev); next.delete(rejectKey); return next; });
        setExpandedRows(prev => { const next = new Set(prev); next.delete(rejectKey); return next; });
        reloadCurrentTab();
      } catch (error: unknown) {
        const reason = getErrorMessage(error, 'Unable to decline request');
        log.error("Failed to decline (supervisor) request #" + row.id, reason);
        alert('Failed to decline request: ' + reason);
      }
    }
  };

  const handleDeleteAudit = async (requestId: number, auditId: number, reason: string) => {
    log.info("Deleting issuance record #" + auditId, `(request #${requestId})`);
    const key = makeRequestKey('item', requestId);
    // Find which item the deleted audit belonged to before it disappears from
    // the refetched data below — there's no other way to trace it back.
    const affectedItemId = requestDetails.get(key)?.items?.find(
      (item: ItemRow) => item.audits?.some((a: ItemAudit) => a.id === auditId)
    )?.id;
    try {
      await statusAPI.deleteIssuanceAudit(auditId, reason);
      const refreshed = await itemRequestAPI.getById(requestId);
      const data = refreshed.data;
      // The Issuance No. box defaults to the item's stored issuance_number so
      // repeat partial releases don't need retyping it — but that number
      // belongs to the audit that was just deleted, so leaving it in place
      // would silently reuse a voided issuance number on the next release.
      // Blank it (and any in-progress "now" qty) for the affected item.
      if (affectedItemId !== undefined && data.items) {
        data.items = data.items.map((item: ItemRow) =>
          item.id === affectedItemId
            ? { ...item, issuance_number: '', quantity_out_now: undefined }
            : item
        );
      }
      setRequestDetails(prev => new Map(prev).set(key, data));
      reloadCurrentTab();
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, 'Failed to delete issuance record');
      log.error("Failed to delete issuance record #" + auditId, reasonMsg);
      alert('Failed to delete issuance record: ' + reasonMsg);
    }
  };

  const handleResetApproval = async (requestId: number, requestType: RequestTab, target?: 'supervisor' | 'custodian') => {
    if (!confirm('Remove the approval and set this request back to pending?')) return;
    log.info("Resetting approval for request #" + requestId, `(${requestType})`, target || 'both');
    try {
      if (requestType === 'item') await statusAPI.resetItemApproval(requestId, target);
      else await statusAPI.resetServiceApproval(requestId, target);
      const key = makeRequestKey(requestType, requestId);
      const response = await (
        requestType === 'item' ? itemRequestAPI.getById(requestId) : serviceRequestAPI.getById(requestId)
      );
      setRequestDetails(prev => new Map(prev).set(key, response.data));
      reloadCurrentTab();
    } catch (error) {
      log.error("Failed to reset approval for request #" + requestId, error);
      alert('Failed to reset approval');
    }
  };

  /**
   * Clears a service line's Receiving Report No. along with who/when entered
   * it — a full undo of that entry, logged to deletion_log (like deleting an
   * item/service line) so it shows up on the Deleted RR No. tab.
   */
  const handleClearReceivingReport = async (requestId: number, serviceId: number, reason: string) => {
    log.info("Clearing receiving report no. for service #" + serviceId, "(request #" + requestId + ")");
    try {
      await statusAPI.clearServiceReceivingReport(serviceId, reason);
      const key = makeRequestKey('service', requestId);
      const response = await serviceRequestAPI.getById(requestId);
      setRequestDetails(prev => new Map(prev).set(key, response.data));
      setEditableServices(prev => {
        if (!prev.has(requestId)) return prev;
        const next = new Map(prev);
        next.delete(requestId);
        return next;
      });
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, 'Failed to clear Receiving Report No.');
      log.error("Failed to clear receiving report no. for service #" + serviceId, reasonMsg);
      alert('Failed to clear Receiving Report No.: ' + reasonMsg);
    }
  };

  const handleDeleteItem = async (requestId: number, itemId: number, reason: string) => {
    try {
      await itemRequestAPI.deleteItem(itemId, reason);
      const key = makeRequestKey('item', requestId);
      setRequestDetails(prev => {
        const details = prev.get(key);
        if (!details?.items) return prev;
        return new Map(prev).set(key, {
          ...details,
          items: details.items.filter((item: ItemRow) => item.id !== itemId),
        });
      });
      alert('Item deleted successfully!');
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, 'Failed to delete item');
      console.error('Error deleting item:', error);
      alert('Failed to delete item: ' + reasonMsg);
    }
  };

  const handleDeleteService = async (requestId: number, serviceId: number, reason: string) => {
    try {
      await serviceRequestAPI.deleteItem(serviceId, reason);
      const key = makeRequestKey('service', requestId);
      setRequestDetails(prev => {
        const details = prev.get(key);
        if (!details?.services) return prev;
        return new Map(prev).set(key, {
          ...details,
          services: details.services.filter((service: ServiceRow) => service.id !== serviceId),
        });
      });
      alert('Service deleted successfully!');
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, 'Failed to delete service');
      console.error('Error deleting service:', error);
      alert('Failed to delete service: ' + reasonMsg);
    }
  };

  const updateItemField = (requestId: number, index: number, field: string, value: FieldValue) => {
    const key = makeRequestKey('item', requestId);
    setRequestDetails(prev => {
      const details = prev.get(key);
      if (!details?.items) return prev;
      const updatedItems = [...details.items];
      const current = updatedItems[index];
      // Issuance Number and Qty Out/Delivered "now" only show inputs for the
      // currently selected delivery status — switching status hides them, but
      // left in the item they would still ride along on the next Save Item
      // Updates (e.g. a stray quantity_out_now silently releasing stock on a
      // row now marked PURCHASE REQUEST). Clear them here so an unsaved edit
      // can't leak into a different status.
      // PR/ and Status are deliberately NOT cleared: they're the only
      // record of an already-completed Purchase/Payment Request delivery, and
      // the Full Delivery history (IssuanceHistory) keeps reading them off the
      // item after the status moves on (e.g. to OUT) — wiping them here would
      // blank that history before the row is even saved.
      const clearedDetails = field === 'delivery_status' && value !== current?.delivery_status
        ? {
            issuance_number: undefined,
            quantity_out_now: undefined,
            quantity_delivered_now: undefined,
            // A Cancel/Close reason only belongs to those statuses.
            ...(itemStatusNeedsReason(String(value ?? '')) ? {} : { status_reason: undefined }),
          }
        : {};
      updatedItems[index] = { ...current, ...clearedDetails, [field]: value };
      return new Map(prev).set(key, { ...details, items: updatedItems });
    });
    // Read the id straight from the pre-update snapshot rather than out of
    // the setRequestDetails updater above: that updater's invocation is
    // deferred by React to the commit phase, so a `let` written inside it
    // and read immediately after the setRequestDetails call would still be
    // undefined here — the updater hasn't run yet.
    const preEditItem = requestDetails.get(key)?.items?.[index];
    if (preEditItem && preEditItem.id !== undefined) {
      const editedItemId = preEditItem.id;
      setDirtyItemIds(prev => new Set(prev).add(editedItemId));
      if (field === 'item_name') {
        setItemNameDirtyIds(prev => new Set(prev).add(editedItemId));
      }
      if (ADJUSTMENT_TRACKED_FIELDS.has(field)) {
        setItemSnapshots(prev => (prev.has(editedItemId) ? prev : new Map(prev).set(editedItemId, preEditItem)));
      }
    }
  };

  /**
   * Sets one field across any number of service rows in a single pass.
   *
   * It has to be one call rather than a loop over `updateService`, because the
   * source array is read from this render's closure: calling it repeatedly would
   * have every call start from the same stale array and the last one would win,
   * so only one row would actually change.
   */
  const updateServiceIndexes = (requestId: number, indexes: number[], field: string, value: FieldValue) => {
    if (indexes.length === 0) return;
    const key = makeRequestKey('service', requestId);
    const currentServices = editableServices.get(requestId) || requestDetails.get(key)?.services || [];
    const updatedServices = [...currentServices];
    // Capture the pre-edit snapshot the first time Description is touched on
    // each row — same idea as updateItemField's itemSnapshots, just scoped to
    // the one tracked field services have.
    if (field === 'description') {
      indexes.forEach(index => {
        const preEditService = currentServices[index];
        if (preEditService && preEditService.id !== undefined) {
          const serviceId = preEditService.id;
          setServiceSnapshots(prev => (prev.has(serviceId) ? prev : new Map(prev).set(serviceId, preEditService)));
        }
      });
    }
    indexes.forEach(index => {
      if (updatedServices[index]) {
        updatedServices[index] = { ...updatedServices[index], [field]: value };
      }
    });
    setEditableServices(prev => new Map(prev).set(requestId, updatedServices));
    setRequestDetails(prev => {
      const details = prev.get(key);
      if (!details) return prev;
      return new Map(prev).set(key, { ...details, services: updatedServices });
    });
    setHasServiceChanges(prev => new Set(prev).add(requestId));
  };

  const updateService = (requestId: number, index: number, field: string, value: FieldValue) =>
    updateServiceIndexes(requestId, [index], field, value);

  const updateRequestDetail = (requestId: number, field: string, value: FieldValue, type: RequestTab = 'service') => {
    const key = makeRequestKey(type, requestId);
    setRequestDetails(prev => {
      const details = prev.get(key);
      if (!details) return prev;
      return new Map(prev).set(key, { ...details, [field]: value });
    });
    if (type === 'item') {
      setHasItemChanges(prev => new Set(prev).add(requestId));
    } else {
      setHasServiceChanges(prev => new Set(prev).add(requestId));
    }
  };

  const getUniqueDepartments = (requests: RequestRow[]): string[] =>
    Array.from(new Set(requests.map(req => req.department).filter(Boolean))).sort();

  // Generic so callers keep their concrete row type instead of widening it.
  const filterByDepartment = <T extends { department: string }>(requests: T[], department: string): T[] =>
    department === 'all' ? requests : requests.filter(req => req.department === department);

  // Dynamically imported — print.ts/printout.ts are only ever needed after a
  // user actually clicks Print, so they don't belong in this hook's (and by
  // extension every dashboard that uses it) initial bundle.
  const handlePrint = async (requestId: number, requestType: 'item' | 'service') => {
    const details = requestDetails.get(makeRequestKey(requestType, requestId));
    if (details) {
      log.info("Printing", requestType, "slip for request #" + requestId);
      const { printRequestSlip } = await import('@/features/requests/utils/print');
      printRequestSlip(details, requestType);
    } else {
      log.warn("Print requested for #" + requestId, "but details not loaded yet");
    }
  };

  const handlePrintout = async (requestId: number, requestType: 'item' | 'service') => {
    const details = requestDetails.get(makeRequestKey(requestType, requestId));
    if (details) {
      log.info("Printing", requestType, "slip for request #" + requestId);
      const { printoutslip } = await import("@/features/requests/utils/printout");
      printoutslip(details, requestType);
    } else {
      log.warn("Print requested for #" + requestId, "but details not loaded yet");
    }
  };

  return {
    activeTab,
    setActiveTab,
    itemRequests,
    serviceRequests,
    filteredItemRequests,
    filteredServiceRequests,
    selectedDepartment,
    setSelectedDepartment,
    selectedRequest,
    showModal,
    setShowModal,
    newStatus,
    setNewStatus,
    rejectionComment,
    setRejectionComment,
    expandedRows,
    requestDetails,
    setRequestDetails,
    editableServices,
    hasItemChanges,
    hasServiceChanges,
    dirtyItemIds,
    itemNameDirtyIds,
    savingAllRequestIds,
    searchQuery,
    setSearchQuery,
    loadItemRequests,
    loadServiceRequests,
    handleRowClick,
    handleStatusClick,
    handleStatusUpdate,
    handleSupervisorAction,
    handleSaveRequestInfo,
    handleSaveItem,
    handleSaveAllItems,
    handleSaveServiceUpdates,
    handleResetApproval,
    handleClearReceivingReport,
    handleDeleteItem,
    handleDeleteService,
    handleDeleteAudit,
    updateItemField,
    updateService,
    updateServiceIndexes,
    updateRequestDetail,
    getUniqueDepartments,
    filterByDepartment,
    handlePrint,
    handlePrintout,
  };
};
