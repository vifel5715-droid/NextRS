import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { debounceByKey } from "@shared/utils/debounce";
import { itemRequestAPI, serviceRequestAPI, statusAPI } from "../../../services/api";
import { getRequestListsAction } from "@server/actions/request-lists";
import { updateRequestItemAction as updateRequestItemResult } from "@server/actions/update-request-item";
import type { ItemRequest, ServiceRequest, RequestDetail, ItemRow, ServiceRow, RequestTab, FieldValue } from "@shared/types";
import { useRequestsChanged, type RequestChangedPayload } from "@shared/hooks/useRequestsChanged";
import { upsertById, removeById } from "@shared/utils/reconcileRequests";
import { makeRequestKey } from "@shared/utils/requestKey";
import { getErrorMessage } from "@shared/utils/errorMessage";
import { createLogger } from "@shared/utils/logger";
import { diffItemRow } from "@features/adjustments/utils/adjustmentSlip";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import { throwOnError } from "@shared/utils/actionResult";

const updateRequestItemAction = throwOnError(updateRequestItemResult);

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
  const [activeTab, setActiveTab] = useState<RequestTab>("item");
  const [itemRequests, setItemRequests] = useState<ItemRequest[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
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

  useEffect(() => {
    setLoading(true);
    const load = activeTab === "item" ? loadItemRequests() : loadServiceRequests();
    load.finally(() => setLoading(false));
  }, [activeTab, loadItemRequests, loadServiceRequests]);

  // Realtime events carry ids only, so the affected list is refetched (debounced).
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
    if (payload.type === "urgent" || payload.type === "reimbursement") return;
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
      updatedItems[index] = { ...updatedItems[index], [field]: value };
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
        pr_status: item.pr_status,
      };
      const outstandingToDeliver = Math.max(0, (item.quantity || 0) - (item.quantity_delivered || 0));
      const deliveredNow = item.quantity_delivered_now ?? (
        item.pr_status === "DELIVERED" && outstandingToDeliver > 0 ? outstandingToDeliver : undefined
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

  return {
    activeTab,
    setActiveTab,
    loading,
    filteredItemRequests,
    filteredServiceRequests,
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
