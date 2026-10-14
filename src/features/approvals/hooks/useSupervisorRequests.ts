import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from '@/lib/next-router';
import { useAuth } from "@/components/providers/AuthProvider";
import { itemRequestAPI, serviceRequestAPI } from '@/lib/api';
import { getRequestListsAction } from "@/features/requests/actions/request-lists";
import { reviewSupervisorRequestAction as reviewSupervisorRequestResult } from "@/features/approvals/actions/supervisor-review";
import { sanitizeUserInput } from '@/lib/utils/sanitize';
import { createLogger } from '@/lib/client-logger';
import { makeRequestKey } from "@/lib/utils/requestKey";
import { useRequestsChanged, type RequestChangedPayload } from '@/hooks/useRequestsChanged';
import { upsertById, removeById } from "@/lib/utils/reconcileRequests";
import { debounce, debounceByKey } from '@/lib/utils/debounce';
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from '@/lib/utils/dateRange';
import { useItemCatalogEntries } from '@/features/item-master/hooks/useItemCatalogEntries';
import type { ItemRequest, ServiceRequest, RequestTab, CacheEntry, ItemRow, ServiceRow, RequestDetail, FieldValue } from '@/types';
import { throwOnError } from "@/lib/utils/actionResult";
import { isAwaitingSupervisorApproval, isFullyApproved } from "@/lib/utils/status";

const reviewSupervisorRequestAction = throwOnError(reviewSupervisorRequestResult);

const log = createLogger("useSupervisorRequests");

const CACHE_TTL = 30000;

// Approval Requests only — a fully approved request has moved on to the
// Pending Item/Service Requests lists. Rows still waiting on this stage sort
// first (stable sort keeps the server's newest-first order within each group).
const approvalRequestsOnly = <T extends { supervisor_status?: string; custodian_status?: string }>(rows: T[]): T[] =>
  rows
    .filter((row) => !isFullyApproved(row))
    .sort((a, b) => Number(isAwaitingSupervisorApproval(b)) - Number(isAwaitingSupervisorApproval(a)));

export const useSupervisorRequests = () => {
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const navigate = useNavigate();

  const [itemRequests, setItemRequests] = useState<ItemRequest[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [activeTab, setActiveTab] = useState<RequestTab>('item');
  const [selectedRequest, setSelectedRequest] = useState<ItemRequest | ServiceRequest | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newStatus, setNewStatus] = useState('approved');
  const [editMode, setEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState({ purpose: '', remarks: '' });
  const [rejectionComment, setRejectionComment] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [requestDetails, setRequestDetails] = useState<Map<string, RequestDetail>>(new Map());
  const [editableItems, setEditableItems] = useState<Map<string, Array<ItemRow | ServiceRow>>>(new Map());
  const [hasChanges, setHasChanges] = useState<Map<string, boolean>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetching = useRef(false);
  const hasMounted = useRef(false);
  const requestCache = useRef<Map<string, CacheEntry<{ itemRequests: ItemRequest[]; serviceRequests: ServiceRequest[] }>>>(new Map());

  const filteredItemRequests = useMemo(() => {
    const inRange = filterByDateRange(approvalRequestsOnly(itemRequests), startDate, endDate, 'created_at');
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q) ||
      (row.pr_numbers?.toLowerCase() || '').includes(q)
    );
  }, [itemRequests, searchQuery, startDate, endDate]);

  const filteredServiceRequests = useMemo(() => {
    const inRange = filterByDateRange(approvalRequestsOnly(serviceRequests), startDate, endDate, 'created_at');
    if (!searchQuery.trim()) return inRange;
    const q = searchQuery.toLowerCase();
    return inRange.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q)
    );
  }, [serviceRequests, searchQuery, startDate, endDate]);

  const fetchPendingRequests = useCallback(async (forceRefresh = false) => {
    const cacheKey = 'pending-requests';
    if (!forceRefresh) {
      const cached = requestCache.current.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        log.log("Cache hit: pending-requests");
        return cached.data;
      }
    }
    if (isFetching.current && !forceRefresh) return null;
    log.info("Fetching pending requests — forceRefresh:", forceRefresh);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      isFetching.current = true;
      const result = await getRequestListsAction();
      log.info("Pending requests fetched — items:", result.itemRequests.length, "services:", result.serviceRequests.length);
      requestCache.current.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return null;
      throw error;
    } finally {
      isFetching.current = false;
    }
  }, []);

  const loadPendingRequests = useCallback(async (forceRefresh = false) => {
    try {
      const result = await fetchPendingRequests(forceRefresh);
      if (result) {
        setItemRequests(result.itemRequests);
        setServiceRequests(result.serviceRequests);
      }
    } catch (error: unknown) {
      console.error('Error loading requests:', error);
    }
  }, [fetchPendingRequests]);

  useEffect(() => {
    const userRole = user?.role?.toLowerCase().trim();
    if (userRole === 'staff' || userRole === 'secretary') navigate('/requests/pending');
  }, [user?.role, navigate]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      log.info("Mounted");
      loadPendingRequests();
    }
  }, [loadPendingRequests]);

  useEffect(() => {
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, []);

  // ARCH: state reconciliation. The server pushes the changed row already
  // projected into list shape (RequestChangedPayload.data), so a
  // create/update patches straight into local state — no refetch of the
  // whole list. Only an already-open detail panel still needs a fetch
  // (list rows don't carry the items/services/approver-name detail shape),
  // debounced per key so a burst of item-level events for the same open
  // request (e.g. batch-saving several rows) collapses into one fetch.
  const requestDetailsRef = useRef(requestDetails);
  useEffect(() => { requestDetailsRef.current = requestDetails; }, [requestDetails]);

  const debouncedDetailRefetch = useRef(
    debounceByKey((key: string, type: RequestTab, id: number) => {
      const fetcher = type === 'item' ? itemRequestAPI.getById(id) : serviceRequestAPI.getById(id);
      fetcher.then(res => setRequestDetails(prev => new Map(prev).set(key, res.data))).catch(() => {});
    }, 400)
  ).current;

  // Realtime events carry ids only, so the list is refetched (debounced).
  const loadPendingRef = useRef(loadPendingRequests);
  useEffect(() => { loadPendingRef.current = loadPendingRequests; }, [loadPendingRequests]);
  const debouncedListReload = useRef(debounce(() => { void loadPendingRef.current(true); }, 500)).current;

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
      if (payload.type === 'item') setItemRequests(prev => upsertById(prev, payload.data!));
      else setServiceRequests(prev => upsertById(prev, payload.data!));
    } else {
      debouncedListReload();
    }

    // Invalidate the TTL cache so a later non-forced loadPendingRequests()
    // (e.g. on remount) doesn't clobber this realtime patch with a stale
    // combined item+service snapshot.
    requestCache.current.delete('pending-requests');

    // Keep an already-open detail panel live instead of showing stale approval state.
    if (requestDetailsRef.current.has(key)) {
      debouncedDetailRefetch(key, payload.type, payload.id);
    }
  }, [debouncedDetailRefetch, debouncedListReload]);

  useRequestsChanged(handleRequestChanged);

  const initializeEditableItems = (key: string, items: Array<ItemRow | ServiceRow>) => {
    setEditableItems(prev => new Map(prev).set(key, [...items]));
    setHasChanges(prev => new Map(prev).set(key, false));
  };

  const handleRowClick = async (row: { id: number }) => {
    const key = makeRequestKey(activeTab, row.id);
    const newExpandedRows = new Set<string>();
    if (!expandedRows.has(key)) {
      newExpandedRows.add(key);
      if (!requestDetails.has(key)) {
        try {
          const response = activeTab === 'item'
            ? await itemRequestAPI.getById(row.id)
            : await serviceRequestAPI.getById(row.id);
          setRequestDetails(prev => new Map(prev).set(key, response.data));
          if (activeTab === 'item' && response.data.items) {
            initializeEditableItems(key, response.data.items);
          } else if (activeTab === 'service' && response.data.services) {
            initializeEditableItems(key, response.data.services);
          }
        } catch (error) {
          console.error('Error fetching request details:', error);
        }
      }
    }
    setExpandedRows(newExpandedRows);
  };

  const handleStatusClick = (row: ItemRequest | ServiceRequest) => {
    if (row.supervisor_status && row.supervisor_status !== 'pending') {
      alert('This request has already been ' + row.supervisor_status + '.');
      return;
    }
    setSelectedRequest(row);
    setNewStatus('approved');
    setEditFormData({ purpose: row.purpose || '', remarks: row.remarks || '' });
    setRejectionComment('');
    setEditMode(false);
    setShowModal(true);
  };

  const handleEdit = async () => {
    if (!selectedRequest) return;
    try {
      const updatedPayload = {
        purpose: sanitizeUserInput(editFormData.purpose),
        remarks: sanitizeUserInput(editFormData.remarks),
      };
      if (activeTab === 'item') await itemRequestAPI.update(selectedRequest.id, updatedPayload);
      else await serviceRequestAPI.update(selectedRequest.id, updatedPayload);

      const editKey = makeRequestKey(activeTab, selectedRequest.id);
      setRequestDetails(prev => {
        const updated = new Map(prev);
        const current = updated.get(editKey) || {};
        updated.set(editKey, { ...current, ...updatedPayload });
        return updated;
      });
      setEditMode(false);
      setShowModal(false);
      loadPendingRequests(true);
      alert('Request updated successfully!');
    } catch {
      alert('Failed to update request.');
    }
  };

  const addItem = (requestId: number) => {
    const key = makeRequestKey(activeTab, requestId);
    const currentItems = editableItems.get(key) || [];
    const newItem = activeTab === 'item'
      ? { item_name: '', quantity: 1, uom: '', remarks: '', delivery_status: 'pending' }
      : { description: '' };
    setEditableItems(prev => new Map(prev).set(key, [...currentItems, newItem]));
    setHasChanges(prev => new Map(prev).set(key, true));
  };

  const deleteItem = (requestId: number, index: number) => {
    const key = makeRequestKey(activeTab, requestId);
    const currentItems = editableItems.get(key) || [];
    setEditableItems(prev => new Map(prev).set(key, currentItems.filter((_, i) => i !== index)));
    setHasChanges(prev => new Map(prev).set(key, true));
  };

  const updateItem = (requestId: number, index: number, field: string, value: FieldValue) => {
    const key = makeRequestKey(activeTab, requestId);
    // Functional update so back-to-back calls (Item Name, then its catalog
    // UoM) each build on the previous one instead of a stale snapshot.
    setEditableItems(prev => {
      const updatedItems = [...(prev.get(key) || [])];
      updatedItems[index] = { ...updatedItems[index], [field]: value };
      return new Map(prev).set(key, updatedItems);
    });
    setHasChanges(prev => new Map(prev).set(key, true));
  };

  const updateItemList = async (requestId: number) => {
    const key = makeRequestKey(activeTab, requestId);
    const items = editableItems.get(key);
    if (!items) return;
    try {
      if (activeTab === 'item') await itemRequestAPI.update(requestId, { items });
      else await serviceRequestAPI.update(requestId, { services: items });
      await handleRowClick({ id: requestId });
      setHasChanges(prev => new Map(prev).set(key, false));
      alert('Items updated successfully!');
    } catch {
      alert('Failed to update items.');
    }
  };

  const handleStatusUpdate = async () => {
    if (!selectedRequest) return;
    if (selectedRequest.supervisor_status && selectedRequest.supervisor_status !== 'pending') {
      alert('This request has already been validated.');
      setShowModal(false);
      return;
    }
    if (newStatus === 'rejected' && !rejectionComment.trim()) {
      alert('Please provide a reason for declining.');
      return;
    }
    log.info("Updating request #" + selectedRequest.id, `to ${newStatus} (${activeTab})`);
    try {
      await reviewSupervisorRequestAction({
        type: activeTab,
        id: selectedRequest.id,
        decision: newStatus === "rejected" ? "rejected" : "approved",
        rejectionComment: newStatus === "rejected" ? sanitizeUserInput(rejectionComment) : undefined,
      });
      log.info("Request #" + selectedRequest.id, "status updated to", newStatus);

      setShowModal(false);
      setRejectionComment('');
      const statusKey = makeRequestKey(activeTab, selectedRequest.id);
      setRequestDetails(prev => {
        const next = new Map(prev);
        next.delete(statusKey);
        return next;
      });
      setExpandedRows(prev => {
        const next = new Set(prev);
        next.delete(statusKey);
        return next;
      });
      loadPendingRequests(true);
    } catch (error: unknown) {
      log.error("Failed to update status for request #" + selectedRequest.id);
      alert(error instanceof Error ? error.message : "Failed to update request status.");
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditMode(false);
  };

  const catalogEntries = useItemCatalogEntries();
  const managerOnlyCatalogNames = useMemo(
    () => new Set(catalogEntries.filter((e) => e.approval_level === 'MANAGER_ONLY').map((e) => e.item_name.trim().toUpperCase())),
    [catalogEntries]
  );

  // Mirrors status.controller.ts's requestNeedsManagerOnlyApproval exactly —
  // a plain supervisor can't approve a request containing an item that's an
  // exact MANAGER_ONLY catalog match. An item that matches no catalog entry
  // at all ("Not Found" — same existence status the Items table badge shows)
  // no longer forces Manager-only approval; a supervisor can approve those
  // like any other item. Service requests have no catalog, so this only ever
  // applies to item requests.
  const requestNeedsManagerOnlyApproval = (items?: ItemRow[]): boolean => {
    if (!items || items.length === 0) return false;
    return items.some((item) => {
      const name = (item.item_name || '').trim().toUpperCase();
      if (!name) return false;
      return managerOnlyCatalogNames.has(name);
    });
  };

  // A supervisor-created request, or one containing a Manager-only/
  // unrecognized item, can only be approved/rejected by a manager (or admin)
  // — a fellow supervisor (including the requester themself) can't sign off.
  const canApproveRequest = (details: { created_by_role?: string; items?: ItemRow[] } | undefined): boolean => {
    const userRole = user?.role?.toLowerCase();
    if (userRole === 'manager' || userRole === 'admin' || userRole === 'operations_manager') return true;
    if (details?.created_by_role?.toLowerCase() === 'supervisor') return false;
    if (requestNeedsManagerOnlyApproval(details?.items)) return false;
    return true;
  };

  return {
    itemRequests,
    serviceRequests,
    filteredItemRequests,
    filteredServiceRequests,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    expandedRows,
    requestDetails,
    editableItems,
    hasChanges,
    selectedRequest,
    showModal,
    newStatus,
    setNewStatus,
    editMode,
    setEditMode,
    editFormData,
    setEditFormData,
    rejectionComment,
    setRejectionComment,
    loadPendingRequests,
    handleRowClick,
    handleStatusClick,
    handleEdit,
    addItem,
    deleteItem,
    updateItem,
    updateItemList,
    handleStatusUpdate,
    closeModal,
    canApproveRequest,
  };
};
