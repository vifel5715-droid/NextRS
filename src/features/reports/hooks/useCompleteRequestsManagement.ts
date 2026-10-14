import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { debounceByKey } from "@/lib/utils/debounce";
import { itemRequestAPI, serviceRequestAPI, statusAPI } from "@/lib/api";
import { getRequestListsAction } from "@/features/requests/actions/request-lists";
import { getReimbursementRequestsAction, getUrgentRequestsAction } from "@/features/requests/actions/special-requests";
import { deleteCompleteRequestsAction } from "@/features/requests/actions/complete-request-deletions";
import { updateRequestItemAction as updateRequestItemResult } from "@/features/requests/actions/update-request-item";
import type { ItemRequest, ServiceRequest, RequestDetail, ItemRow, ServiceRow, RequestTab, FieldValue, UrgentRequest, ReimbursementRequest } from "@/types";
import { useRequestsChanged, type RequestChangedPayload } from "@/hooks/useRequestsChanged";
import { upsertById, removeById } from "@/lib/utils/reconcileRequests";
import { makeRequestKey } from "@/lib/utils/requestKey";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { createLogger } from "@/lib/client-logger";
import { diffItemRow } from "@/features/reports/utils/adjustmentSlip";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { throwOnError } from "@/lib/utils/actionResult";
import { getItemStatusText, itemStatusNeedsReason } from "@/lib/utils/status";

const updateRequestItemAction = throwOnError(updateRequestItemResult);
const deleteCompleteRequests = throwOnError(deleteCompleteRequestsAction);

export type CompleteRequestsTab = RequestTab | "urgent" | "reimbursement";

/** Same rule as PurchaserDashboard's "Delivered" label — only Not
 * Inventoriable items track delivery, and every one of them must be delivered. */
export const isUrgentRequestComplete = (request: UrgentRequest): boolean => {
  const tracked = request.items.filter((item) => !item.is_inventoriable);
  return tracked.length > 0 && tracked.every((item) => item.delivery_status === "delivered");
};

const log = createLogger("useCompleteRequestsManagement");

// Item fields an Adjustment History entry is logged for when changed on save —
// see handleSaveItem/updateItemField below.
const ADJUSTMENT_TRACKED_FIELDS = new Set(["item_name", "quantity", "uom", "remarks", "machine_code"]);

/**
 * Item requests where every item has nothing left to release, and service
 * requests whose PR has been marked "finish" — with the same editing
 * capabilities the custodian has on Pending Requests (status, issuance/PR
 * fields, delete item/audit) — a completed request can still need a
 * correction. See useRequestManagement.ts for the pending-side counterpart
 * this mirrors.
 */
export const useCompleteRequestsManagement = () => {
  const { startDate, endDate } = useDateRangeContext();
  const [activeTab, setActiveTab] = useState<CompleteRequestsTab>("item");
  const [itemRequests, setItemRequests] = useState<ItemRequest[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>([]);
  const [reimbursementRequests, setReimbursementRequests] = useState<ReimbursementRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [requestDetails, setRequestDetails] = useState<Map<string, RequestDetail>>(new Map());
  const [hasServiceChanges, setHasServiceChanges] = useState<Set<number>>(new Set());
  // Which item rows (by item id) have unsaved field edits — drives each
  // row's own Save button rather than one button for the whole table.
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<number>>(new Set());
  // Pre-edit snapshot of each dirty item row (by item id), captured the moment
  // an Adjustment History-tracked field is first touched — the Before side of
  // the Adjustment Remarks prompt/history entry on save. See handleSaveItem.
  const [itemSnapshots, setItemSnapshots] = useState<Map<number, ItemRow>>(new Map());
  const [editableServices, setEditableServices] = useState<Map<number, ServiceRow[]>>(new Map());

  const filteredItemRequests = useMemo(() => {
    const inRange = filterByDateRange(itemRequests, startDate, endDate, "created_at");
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter((row) =>
      (row.serial?.toLowerCase() || "").includes(q) ||
      (row.created_at?.toLowerCase() || "").includes(q) ||
      (row.purpose?.toLowerCase() || "").includes(q) ||
      (row.remarks?.toLowerCase() || "").includes(q) ||
      (row.pr_numbers?.toLowerCase() || "").includes(q)
    );
  }, [itemRequests, searchQuery, startDate, endDate]);

  const filteredServiceRequests = useMemo(() => {
    const inRange = filterByDateRange(serviceRequests, startDate, endDate, "created_at");
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter((row) =>
      (row.serial?.toLowerCase() || "").includes(q) ||
      (row.created_at?.toLowerCase() || "").includes(q) ||
      (row.purpose?.toLowerCase() || "").includes(q) ||
      (row.remarks?.toLowerCase() || "").includes(q) ||
      (row.pr_number?.toLowerCase() || "").includes(q)
    );
  }, [serviceRequests, searchQuery, startDate, endDate]);

  const filteredUrgentRequests = useMemo(() => {
    const inRange = filterByDateRange(urgentRequests, startDate, endDate, "created_at");
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter((row) =>
      (row.serial?.toLowerCase() || "").includes(q) ||
      (row.created_at?.toLowerCase() || "").includes(q) ||
      (row.purpose?.toLowerCase() || "").includes(q) ||
      (row.remarks?.toLowerCase() || "").includes(q) ||
      (row.requested_by?.toLowerCase() || "").includes(q)
    );
  }, [urgentRequests, searchQuery, startDate, endDate]);

  const filteredReimbursementRequests = useMemo(() => {
    const inRange = filterByDateRange(reimbursementRequests, startDate, endDate, "created_at");
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter((row) =>
      (row.serial?.toLowerCase() || "").includes(q) ||
      (row.created_at?.toLowerCase() || "").includes(q) ||
      (row.purpose?.toLowerCase() || "").includes(q) ||
      (row.remarks?.toLowerCase() || "").includes(q) ||
      (row.supplier?.toLowerCase() || "").includes(q) ||
      (row.requested_by?.toLowerCase() || "").includes(q)
    );
  }, [reimbursementRequests, searchQuery, startDate, endDate]);

  const loadItemRequests = useCallback(async () => {
    log.info("Loading complete item requests");
    try {
      const res = await getRequestListsAction();
      const data = res.itemRequests.filter((r) => r.all_items_served);
      log.info("Complete item requests loaded:", data.length, "records");
      setItemRequests(data);
    } catch (error) {
      log.error("Failed to load complete item requests:", error);
    }
  }, []);

  const loadServiceRequests = useCallback(async () => {
    log.info("Loading complete service requests");
    try {
      const res = await getRequestListsAction();
      const data = res.serviceRequests.filter((r) => r.pr_status === "finish");
      log.info("Complete service requests loaded:", data.length, "records");
      setServiceRequests(data);
    } catch (error) {
      log.error("Failed to load complete service requests:", error);
    }
  }, []);

  // Roles without access to these workflows get a permission error from the
  // read action — treated as an empty list rather than a failure.
  const loadUrgentRequests = useCallback(async () => {
    try {
      const data = (await getUrgentRequestsAction()).filter(isUrgentRequestComplete);
      setUrgentRequests(data);
    } catch (error) {
      log.warn("Complete urgent requests unavailable:", error);
      setUrgentRequests([]);
    }
  }, []);

  const loadReimbursementRequests = useCallback(async () => {
    try {
      const data = (await getReimbursementRequestsAction()).filter((r) => r.ap_status === "closed");
      setReimbursementRequests(data);
    } catch (error) {
      log.warn("Complete reimbursement requests unavailable:", error);
      setReimbursementRequests([]);
    }
  }, []);

  const loadTab = useCallback((tab: string) => {
    if (tab === "item") return loadItemRequests();
    if (tab === "service") return loadServiceRequests();
    if (tab === "urgent") return loadUrgentRequests();
    return loadReimbursementRequests();
  }, [loadItemRequests, loadServiceRequests, loadUrgentRequests, loadReimbursementRequests]);

  // Only a tab's first load blanks the table; switching back to a tab (or
  // returning to this page) refreshes it in the background over the rows
  // already shown.
  const loadedTabs = useRef(new Set<string>());
  useEffect(() => {
    if (!loadedTabs.current.has(activeTab)) setLoading(true);
    loadTab(activeTab).finally(() => {
      loadedTabs.current.add(activeTab);
      setLoading(false);
    });
  }, [activeTab, loadTab]);

  // Realtime events carry ids only, so the affected list is refetched (debounced).
  const loadTabRef = useRef(loadTab);
  useEffect(() => { loadTabRef.current = loadTab; }, [loadTab]);
  const debouncedListReload = useRef(
    debounceByKey((key: string) => { void loadTabRef.current(key); }, 500)
  ).current;

  const handleRequestChanged = useCallback((payload: RequestChangedPayload) => {
    if (payload.type === "urgent" || payload.type === "reimbursement") {
      if (payload.action === "deleted") {
        if (payload.type === "urgent") setUrgentRequests((prev) => removeById(prev, payload.id));
        else setReimbursementRequests((prev) => removeById(prev, payload.id));
      } else {
        debouncedListReload(payload.type);
      }
      return;
    }
    const key = makeRequestKey(payload.type, payload.id);

    if (payload.action === "deleted") {
      if (payload.type === "item") setItemRequests((prev) => removeById(prev, payload.id));
      else setServiceRequests((prev) => removeById(prev, payload.id));
      setRequestDetails((prev) => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
      setExpandedRows((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });
      return;
    }

    if (payload.data) {
      if (payload.type === "item") {
        // A request only belongs here once every item has nothing left to
        // release — anything else (e.g. a delete un-serving it) drops back out.
        setItemRequests((prev) => payload.data!.all_items_served ? upsertById(prev, payload.data!) : removeById(prev, payload.id));
      } else {
        const isFinished = (payload.data as ServiceRequest).pr_status === "finish";
        setServiceRequests((prev) => isFinished ? upsertById(prev, payload.data!) : removeById(prev, payload.id));
      }
    } else {
      debouncedListReload(payload.type);
    }

    if (requestDetails.has(key)) {
      const fetcher = payload.type === "item" ? itemRequestAPI.getById(payload.id) : serviceRequestAPI.getById(payload.id);
      fetcher.then((res) => setRequestDetails((prev) => new Map(prev).set(key, res.data))).catch(() => {});
    }
  }, [requestDetails, debouncedListReload]);

  useRequestsChanged(handleRequestChanged);

  const handleRowClick = useCallback(async (row: ItemRequest | ServiceRequest) => {
    if (activeTab !== "item" && activeTab !== "service") return;
    const key = makeRequestKey(activeTab, row.id);
    const newExpandedRows = new Set<string>();
    if (!expandedRows.has(key)) {
      newExpandedRows.add(key);
      if (!requestDetails.has(key)) {
        try {
          const response = activeTab === "item" ? await itemRequestAPI.getById(row.id) : await serviceRequestAPI.getById(row.id);
          setRequestDetails((prev) => new Map(prev).set(key, response.data));
        } catch (error) {
          log.error("Failed to load request detail #" + row.id, error);
        }
      }
    }
    setExpandedRows(newExpandedRows);
  }, [activeTab, expandedRows, requestDetails]);

  const updateItemField = (requestId: number, index: number, field: string, value: FieldValue) => {
    const key = makeRequestKey("item", requestId);
    setRequestDetails((prev) => {
      const detail = prev.get(key);
      if (!detail?.items) return prev;
      const updatedItems = [...detail.items];
      const current = updatedItems[index];
      // A Cancel/Close reason only belongs to those statuses.
      const clearedReason =
        field === "delivery_status" && value !== current?.delivery_status && !itemStatusNeedsReason(String(value ?? ""))
          ? { status_reason: undefined }
          : {};
      updatedItems[index] = { ...current, ...clearedReason, [field]: value };
      return new Map(prev).set(key, { ...detail, items: updatedItems });
    });
    // See useRequestManagement's updateItemField for why this reads the id
    // from the pre-update snapshot instead of out of the updater above.
    const preEditItem = requestDetails.get(key)?.items?.[index];
    if (preEditItem && preEditItem.id !== undefined) {
      const editedItemId = preEditItem.id;
      setDirtyItemIds((prev) => new Set(prev).add(editedItemId));
      if (ADJUSTMENT_TRACKED_FIELDS.has(field)) {
        setItemSnapshots((prev) => (prev.has(editedItemId) ? prev : new Map(prev).set(editedItemId, preEditItem)));
      }
    }
  };

  // Saves exactly one item row — the per-row Save button (or Enter inside
  // that row) — rather than every edited row in the request at once, so
  // editing one row can never accidentally also commit another row's
  // in-progress edit. See useRequestManagement's handleSaveItem counterpart.
  const handleSaveItem = async (requestId: number, itemId: number) => {
    const details = requestDetails.get(makeRequestKey("item", requestId));
    const item = details?.items?.find((i: ItemRow) => i.id === itemId);
    if (!item) return;

    if (!item.item_name?.trim()) {
      alert("Item Name cannot be blank");
      return;
    }
    if (itemStatusNeedsReason(item.delivery_status) && !item.status_reason?.trim()) {
      alert(`A reason is required to mark this item as ${getItemStatusText(item)}`);
      return;
    }

    // Adjustment History: only gates/logs when a tracked field actually
    // changed from the pre-edit snapshot — untouched saves (e.g. only a status
    // or PR field changed) don't prompt. Remarks are collected up front and
    // sent along with the save so the server can log the entry — see
    // useRequestManagement's handleSaveItem counterpart.
    const snapshot = itemSnapshots.get(itemId);
    const itemIndex = details?.items?.findIndex((i: ItemRow) => i.id === itemId) ?? -1;
    const changes = snapshot
      ? diffItemRow(snapshot, item, `Item #${itemIndex + 1} — ${item.item_name || "N/A"}`)
      : [];
    let adjustmentRemarks = "";
    if (changes.length > 0) {
      const enteredRemarks = window.prompt("Enter Adjustment Remarks for this change:");
      if (enteredRemarks === null) return;
      adjustmentRemarks = enteredRemarks;
    }

    log.info("Saving item #" + itemId, "for request #" + requestId);
    try {
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
      const outstandingToDeliver = Math.max(0, (item.quantity || 0) - (item.quantity_delivered || 0));
      const deliveredNow = item.quantity_delivered_now ?? (
        item.delivery_status === "URGENT" && item.pr_status === "DELIVERED" && outstandingToDeliver > 0 ? outstandingToDeliver : undefined
      );
      if (deliveredNow !== undefined && deliveredNow !== null) {
        data.quantity_delivered = deliveredNow;
      }
      const outstandingToRelease = Math.max(0, (item.quantity || 0) - (item.quantity_out || 0));
      const releasedNow = item.quantity_out_now ?? (
        item.delivery_status === "OUT" && item.issuance_number ? outstandingToRelease : undefined
      );
      if (releasedNow !== undefined && releasedNow !== null) {
        data.quantity_out = releasedNow;
      }
      if (changes.length > 0) data.adjustment_remarks = adjustmentRemarks;
      await updateRequestItemAction(item.id!, data);
      const refreshed = await itemRequestAPI.getById(requestId);
      setRequestDetails((prev) => new Map(prev).set(makeRequestKey("item", requestId), refreshed.data));
      log.info("Item #" + itemId, "saved");
      setDirtyItemIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
      setItemSnapshots((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
      loadItemRequests();
    } catch (error: unknown) {
      const reason = getErrorMessage(error, "Failed to save item");
      log.error("Failed to save item #" + itemId, reason);
      alert("Failed to save item: " + reason);
    }
  };

  const handleDeleteItem = async (requestId: number, itemId: number, reason: string) => {
    try {
      await itemRequestAPI.deleteItem(itemId, reason);
      const key = makeRequestKey("item", requestId);
      setRequestDetails((prev) => {
        const details = prev.get(key);
        if (!details?.items) return prev;
        return new Map(prev).set(key, {
          ...details,
          items: details.items.filter((item: ItemRow) => item.id !== itemId),
        });
      });
      alert("Item deleted successfully!");
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, "Failed to delete item");
      log.error("Failed to delete item", reasonMsg);
      alert("Failed to delete item: " + reasonMsg);
    }
  };

  const handleDeleteService = async (requestId: number, serviceId: number, reason: string) => {
    try {
      await serviceRequestAPI.deleteItem(serviceId, reason);
      const key = makeRequestKey("service", requestId);
      setRequestDetails((prev) => {
        const details = prev.get(key);
        if (!details?.services) return prev;
        return new Map(prev).set(key, {
          ...details,
          services: details.services.filter((service: ServiceRow) => service.id !== serviceId),
        });
      });
      alert("Service deleted successfully!");
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, "Failed to delete service");
      log.error("Failed to delete service", reasonMsg);
      alert("Failed to delete service: " + reasonMsg);
    }
  };

  const handleDeleteAudit = async (requestId: number, auditId: number, reason: string) => {
    try {
      await statusAPI.deleteIssuanceAudit(auditId, reason);
      const refreshed = await itemRequestAPI.getById(requestId);
      setRequestDetails((prev) => new Map(prev).set(makeRequestKey("item", requestId), refreshed.data));
      loadItemRequests();
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, "Failed to delete issuance record");
      log.error("Failed to delete issuance record #" + auditId, reasonMsg);
      alert("Failed to delete issuance record: " + reasonMsg);
    }
  };

  const updateRequestDetail = (requestId: number, field: string, value: FieldValue) => {
    const key = makeRequestKey("service", requestId);
    setRequestDetails((prev) => {
      const details = prev.get(key);
      if (!details) return prev;
      return new Map(prev).set(key, { ...details, [field]: value });
    });
    setHasServiceChanges((prev) => new Set(prev).add(requestId));
  };

  const updateServiceIndexes = (requestId: number, indexes: number[], field: string, value: FieldValue) => {
    if (indexes.length === 0) return;
    const key = makeRequestKey("service", requestId);
    const currentServices = editableServices.get(requestId) || requestDetails.get(key)?.services || [];
    const updatedServices = [...currentServices];
    indexes.forEach((index) => {
      if (updatedServices[index]) {
        updatedServices[index] = { ...updatedServices[index], [field]: value };
      }
    });
    setEditableServices((prev) => new Map(prev).set(requestId, updatedServices));
    setRequestDetails((prev) => {
      const details = prev.get(key);
      if (!details) return prev;
      return new Map(prev).set(key, { ...details, services: updatedServices });
    });
    setHasServiceChanges((prev) => new Set(prev).add(requestId));
  };

  const updateService = (requestId: number, index: number, field: string, value: FieldValue) =>
    updateServiceIndexes(requestId, [index], field, value);

  const handleSaveServiceUpdates = async (requestId: number) => {
    const details = requestDetails.get(makeRequestKey("service", requestId));
    if (!details) return;
    log.info("Saving service updates for request #" + requestId);
    try {
      await serviceRequestAPI.update(requestId, {
        pr_number: details.pr_number,
        pr_status: details.pr_status,
        purpose: details.purpose,
        remarks: details.remarks,
      });
      if (details.services) {
        await Promise.all(
          details.services.map((service: ServiceRow) =>
            statusAPI.updateServiceItem(service.id!, {
              description: service.description,
              delivery_status: service.delivery_status,
              receiving_report_no: service.receiving_report_no,
            })
          )
        );
      }
      // Re-fetch rather than trust the locally-edited copy — the server can
      // override what was sent (e.g. clearing an existing receiving_report_no
      // forces delivery_status/pr_status back to pending regardless of what
      // the dropdowns still showed at save time).
      const key = makeRequestKey("service", requestId);
      const refreshed = await serviceRequestAPI.getById(requestId);
      setRequestDetails((prev) => new Map(prev).set(key, refreshed.data));
      log.info("Service updates saved for request #" + requestId);
      alert("Service updates saved successfully!");
      setHasServiceChanges((prev) => { const next = new Set(prev); next.delete(requestId); return next; });
      setEditableServices((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
      loadServiceRequests();
    } catch (error: unknown) {
      const reason = getErrorMessage(error, "Failed to save service updates");
      log.error("Failed to save service updates for request #" + requestId, reason);
      alert("Failed to save service updates: " + reason);
    }
  };

  /**
   * Clears a service line's Receiving Report No. along with who/when entered
   * it — a full undo of that entry, logged to deletion_log (Deleted RR No. tab).
   */
  const handleClearReceivingReport = async (requestId: number, serviceId: number, reason: string) => {
    log.info("Clearing receiving report no. for service #" + serviceId, "(request #" + requestId + ")");
    try {
      await statusAPI.clearServiceReceivingReport(serviceId, reason);
      const key = makeRequestKey("service", requestId);
      const refreshed = await serviceRequestAPI.getById(requestId);
      setRequestDetails((prev) => new Map(prev).set(key, refreshed.data));
      setEditableServices((prev) => { const next = new Map(prev); next.delete(requestId); return next; });
    } catch (error: unknown) {
      const reasonMsg = getErrorMessage(error, "Failed to clear Receiving Report No.");
      log.error("Failed to clear receiving report no. for service #" + serviceId, reasonMsg);
      alert("Failed to clear Receiving Report No.: " + reasonMsg);
    }
  };

  /**
   * Admin-only: deletes every completed request of the active tab that the
   * current Start/End Date range (and search) matches. The server re-checks
   * each id is still complete before deleting it.
   */
  const handleDeleteInRange = async (): Promise<void> => {
    const rows: { id: number }[] =
      activeTab === "item" ? filteredItemRequests :
      activeTab === "service" ? filteredServiceRequests :
      activeTab === "urgent" ? filteredUrgentRequests :
      filteredReimbursementRequests;
    if (rows.length === 0) return;
    log.info("Deleting", rows.length, activeTab, "complete requests in range");
    try {
      const result = await deleteCompleteRequests(activeTab, rows.map((r) => r.id));
      alert(
        `Deleted ${result.deleted} request(s).` +
        (result.skipped > 0 ? ` ${result.skipped} skipped because they are no longer complete.` : "")
      );
    } catch (error: unknown) {
      const reason = getErrorMessage(error, "Failed to delete requests");
      log.error("Failed to delete complete requests", reason);
      alert("Failed to delete requests: " + reason);
    } finally {
      setExpandedRows(new Set());
      await loadTab(activeTab);
    }
  };

  return {
    activeTab,
    setActiveTab,
    loading,
    filteredItemRequests,
    filteredServiceRequests,
    filteredUrgentRequests,
    filteredReimbursementRequests,
    handleDeleteInRange,
    searchQuery,
    setSearchQuery,
    expandedRows,
    requestDetails,
    hasServiceChanges,
    dirtyItemIds,
    editableServices,
    handleRowClick,
    updateItemField,
    handleSaveItem,
    handleDeleteItem,
    handleDeleteService,
    handleDeleteAudit,
    updateRequestDetail,
    updateService,
    updateServiceIndexes,
    handleSaveServiceUpdates,
    handleClearReceivingReport,
  };
};
