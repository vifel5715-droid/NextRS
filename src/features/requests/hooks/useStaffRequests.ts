import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type React from 'react';
import { useSearchParams } from '@shared/next-router';
import { useAuth } from "@app/providers/AuthProvider";
import { itemRequestAPI, serviceRequestAPI, statusAPI } from '../../../services/api';
import { getStaffRequestsAction } from "@server/actions/staff-requests";
import { createItemRequestAction } from "@server/actions/create-item-request";
import { fetchWithRetry } from '@shared/utils/fetchWithRetry';
import { createLogger } from '@shared/utils/logger';
import { makeRequestKey } from "@shared/utils/requestKey";
import { useRequestsChanged, type RequestChangedPayload } from '@shared/hooks/useRequestsChanged';
import { upsertById, removeById } from "@shared/utils/reconcileRequests";
import { debounceByKey } from '@shared/utils/debounce';
import { getErrorMessage } from '@shared/utils/errorMessage';
import { getCompositeStatus } from "@shared/utils/status";
import { diffItemRow, type AdjustmentChange } from '@features/adjustments/utils/adjustmentSlip';
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from '@shared/utils/dateRange';

import type {
  ItemRequest,
  ServiceRequest,
  ItemRow,
  ServiceRow,
  ItemFormData,
  ServiceFormData,
  RequestTab,
  EditableRequestDetail,
  CacheEntry,
  RequestDetail,
  FieldValue,
} from '@shared/types';

interface RequestRow {
  created_by_role?: string;
}

const log = createLogger("useStaffRequests");
const CACHE_TTL = 30000;

export const useStaffRequests = () => {
  const { user } = useAuth();
  const { startDate, endDate } = useDateRangeContext();
  const [searchParams] = useSearchParams();

  // Request data
  const [itemRequests, setItemRequests] = useState<ItemRequest[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [requestDetails, setRequestDetails] = useState<Map<string, RequestDetail>>(new Map());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filter / search
  const [activeTab, setActiveTab] = useState<RequestTab>('item');
  const [searchQuery, setSearchQuery] = useState('');

  // Create request modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectRequest, setRejectRequest] = useState<ItemRequest | ServiceRequest | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [editingRequestType, setEditingRequestType] = useState<RequestTab>('item');
  const [editableDetails, setEditableDetails] = useState<Map<number, EditableRequestDetail>>(new Map());

  // Create forms
  const [itemFormData, setItemFormData] = useState<ItemFormData>({
    department: '',
    requested_by: '',
    request_type: 'out',
    purpose: '',
    remarks: '',
  });
  const [itemTableData, setItemTableData] = useState<ItemRow[]>([
    { item_name: '', quantity: 1, uom: '', remarks: '' },
  ]);
  const [serviceFormData, setServiceFormData] = useState<ServiceFormData>({
    department: '',
    requested_by: '',
    purpose: '',
    remarks: '',
  });
  const [serviceTableData, setServiceTableData] = useState<ServiceRow[]>([
    { description: '' },
  ]);
  // Percent (0-100) while an item request's attachment upload is in flight;
  // null the rest of the time. Separate from the general submit state since
  // it's the only step slow enough on a large PDF to need visible feedback.
  const [itemAttachmentUploadProgress, setItemAttachmentUploadProgress] = useState<number | null>(null);

  // Refs
  const hasMounted = useRef(false);
  const isFetching = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestCache = useRef<Map<string, CacheEntry<ItemRequest[] | ServiceRequest[] | { itemRequests: ItemRequest[]; serviceRequests: ServiceRequest[] }>>>(new Map());

  // Role Checks
  const isSupervisor = user?.role?.toLowerCase() === 'supervisor' || user?.role?.toLowerCase() === 'manager';
  const isManager = user?.role?.toLowerCase() === 'manager' || user?.role?.toLowerCase() === 'admin';

  // Requests still awaiting action sort above everything else — a manager
  // shouldn't have to scan past already-approved rows to find what needs
  // their attention. Array.prototype.sort is stable, so the recency order
  // the server already applied is preserved within each group.
  const byPendingFirst = <T,>(rows: T[]): T[] =>
    [...rows].sort((a, b) => {
      const aPending = getCompositeStatus(a as Record<string, unknown>).class === 'pending' ? 0 : 1;
      const bPending = getCompositeStatus(b as Record<string, unknown>).class === 'pending' ? 0 : 1;
      return aPending - bPending;
    });

  // Search + date-range memoization
  const filteredItemRequests = useMemo(() => {
    const inRange = filterByDateRange(itemRequests, startDate, endDate, 'created_at');
    if (!searchQuery.trim()) return byPendingFirst(inRange);
    const q = searchQuery.toLowerCase();
    return byPendingFirst(inRange.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q) ||
      (row.pr_numbers?.toLowerCase() || '').includes(q)
    ));
  }, [itemRequests, searchQuery, startDate, endDate]);

  const filteredServiceRequests = useMemo(() => {
    const inRange = filterByDateRange(serviceRequests, startDate, endDate, 'created_at');
    if (!searchQuery.trim()) return byPendingFirst(inRange);
    const q = searchQuery.toLowerCase();
    return byPendingFirst(inRange.filter(row =>
      (row.serial?.toLowerCase() || '').includes(q) ||
      (row.created_at?.toLowerCase() || '').includes(q) ||
      (row.purpose?.toLowerCase() || '').includes(q) ||
      (row.remarks?.toLowerCase() || '').includes(q)
    ));
  }, [serviceRequests, searchQuery, startDate, endDate]);

  // Data fetching
  const loadRequests = useCallback(async (forceRefresh = false) => {
    if (isFetching.current && !forceRefresh) return;
    log.info("Loading requests — forceRefresh:", forceRefresh);
    isFetching.current = true;
    setIsLoading(true);
    setApiError(null);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    try {
      const cacheKey = `${user?.department}-${user?.name}`;
      const itemCache = requestCache.current.get(`items-${cacheKey}`);
      const serviceCache = requestCache.current.get(`services-${cacheKey}`);
      if (
        !forceRefresh &&
        itemCache &&
        serviceCache &&
        Date.now() - itemCache.timestamp < CACHE_TTL &&
        Date.now() - serviceCache.timestamp < CACHE_TTL
      ) {
        setItemRequests(itemCache.data as ItemRequest[]);
        setServiceRequests(serviceCache.data as ServiceRequest[]);
        return;
      }

      const data = await getStaffRequestsAction();
      log.info("Requests loaded — items:", data.itemRequests.length, "services:", data.serviceRequests.length);
      const timestamp = Date.now();
      requestCache.current.set(`items-${cacheKey}`, { data: data.itemRequests, timestamp });
      requestCache.current.set(`services-${cacheKey}`, { data: data.serviceRequests, timestamp });
      setItemRequests(data.itemRequests);
      setServiceRequests(data.serviceRequests);
    } catch (error: unknown) {
      const msg = getErrorMessage(error, '');
      log.error("Failed to load requests:", msg);
      if (msg.includes('internal error')) setApiError('Server encountered an internal error. Please try again.');
      else if (msg.includes('temporarily unavailable')) setApiError('Server is temporarily unavailable. Please try again later.');
      else if (msg.includes('session has expired')) setApiError('Your session has expired. Please log in again.');
      else if (msg.includes('permission to access')) setApiError('You do not have permission to access this resource.');
      else if (msg.includes('not found')) setApiError('The requested resource was not found.');
      else if (msg.includes('busy')) setApiError('Server is busy. Please refresh the page to try again.');
      else if (!msg.includes('cancelled')) setApiError('Failed to load requests. Please try again.');
    } finally {
      isFetching.current = false;
      setIsLoading(false);
    }
  }, [user?.department, user?.name]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      if (user) {
        log.info("Mounted for user:", user.name, `(${user.role} / ${user.department})`);
        setItemFormData(prev => ({ ...prev, department: user.department, requested_by: user.name, request_type: 'out' }));
        setServiceFormData(prev => ({ ...prev, department: user.department, requested_by: user.name }));
        void loadRequests();
      }
    }
  }, [user, loadRequests]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      isFetching.current = false;
    };
  }, []);

  // Real-time state reconciliation
  const requestDetailsRef = useRef(requestDetails);
  useEffect(() => { requestDetailsRef.current = requestDetails; }, [requestDetails]);

  const debouncedDetailRefetch = useRef(
    debounceByKey((key: string, type: RequestTab, id: number) => {
      const fetcher = type === 'item' ? itemRequestAPI.getById(id) : serviceRequestAPI.getById(id);
      fetcher.then(res => setRequestDetails(prev => new Map(prev).set(key, res.data))).catch(() => {});
    }, 400)
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
      if (payload.type === 'item') {
        // A request that just became fully served moves to the Complete
        // Requests page instead — drop it here rather than upsert it back in.
        setItemRequests(prev => payload.data!.all_items_served ? removeById(prev, payload.id) : upsertById(prev, payload.data!));
      } else {
        // A service request whose PR just got marked "finish" moves to the
        // Complete Requests page instead — drop it here rather than upsert it back in.
        const data = payload.data as ServiceRequest;
        setServiceRequests(prev => data.pr_status === "finish" ? removeById(prev, payload.id) : upsertById(prev, payload.data!));
      }
    }

    requestCache.current.delete(`${payload.type === 'item' ? 'items' : 'services'}-${user?.department}-${user?.name}`);

    if (requestDetailsRef.current.has(key)) {
      debouncedDetailRefetch(key, payload.type, payload.id);
    }
  }, [debouncedDetailRefetch, user?.department, user?.name]);

  useRequestsChanged(handleRequestChanged);

  // Permission Logic
  const canEditRequest = useCallback((details: RequestDetail | undefined): boolean => {
    if (!details) return false;
    const userRole = user?.role?.toLowerCase();
    const creatorRole = details.created_by_role?.toLowerCase();
    const status = details.supervisor_status?.toLowerCase();

    // Prevent edit if already approved
    if (status === "approved") return false;

    // Managers / Admins can edit pending requests (including manager-created ones)
    if (isManager || userRole === "manager" || userRole === "admin") {
      return true;
    }

    // Supervisors cannot edit requests created by a Manager
    if (isSupervisor) {
      if (creatorRole === "manager") return false;
      return !status || status === "pending";
    }

    // Secretary can edit ANY item/service request — not just their own —
    // while it's still awaiting review, unlike plain Staff below who stay
    // restricted to their own. Same "not yet approved" gate as everyone
    // else: locked once either approval stage has acted (approved OR
    // rejected), so an edit can't retroactively change what was already
    // decided.
    if (userRole === "secretary") {
      const custodianStatus = details.custodian_status?.toLowerCase();
      const supervisorDone = status === "approved" || status === "rejected";
      const custodianDone = custodianStatus === "approved" || custodianStatus === "rejected";
      return !supervisorDone && !custodianDone;
    }

    // Staff can edit their own request, but only while it's still awaiting
    // review — once either approval stage has acted (approved OR rejected),
    // the request is locked so an edit can't retroactively change what was
    // already approved/rejected.
    //
    // "Own" means either actually created it, OR is the named requester —
    // a secretary can submit on someone else's behalf (see StaffDashboard's
    // isSecretary comment), which sets `created_by` to the secretary but
    // `requested_by` to the staff member's name. The server-side list action
    // scopes results to the named requester, so without this the request
    // shows up in that staff member's own list but they can't edit it.
    if (userRole === "staff") {
      const isCreator = !!details.created_by && details.created_by === user?.id;
      const isNamedRequester =
        !!details.requested_by && !!user?.name &&
        details.requested_by.trim().toUpperCase() === user.name.trim().toUpperCase();
      if (!isCreator && !isNamedRequester) return false;
      const custodianStatus = details.custodian_status?.toLowerCase();
      const supervisorDone = status === "approved" || status === "rejected";
      const custodianDone = custodianStatus === "approved" || custodianStatus === "rejected";
      return !supervisorDone && !custodianDone;
    }

    return false;
  }, [isManager, isSupervisor, user?.role, user?.id, user?.name]);

  const canApproveRequest = useCallback((row: RequestRow): boolean => {
    const userRole = user?.role?.toLowerCase();
    const creatorRole = row.created_by_role?.toLowerCase();

    // Managers can approve requests
    if (isManager || userRole === 'manager') {
      return true;
    }

    // Supervisors cannot approve requests created by Managers or fellow Supervisors
    if (isSupervisor) {
      if (creatorRole === "manager" || creatorRole === "supervisor") {
        return false;
      }
      return true;
    }

    return false;
  }, [isManager, isSupervisor, user?.role]);

  // Form row control actions
  const addItemRow = () =>
    setItemTableData(prev => [...prev, { item_name: '', quantity: 1, uom: '', remarks: '' }]);

  const removeItemRow = (index: number) => {
    if (itemTableData.length > 1) setItemTableData(prev => prev.filter((_, i) => i !== index));
  };

  // Filling in the Item Name on what's currently the last row auto-appends a
  // fresh empty row after it, so there's always one ready to type into next —
  // replaces a manual "+ Add Item" button. Only fires off `item_name` (the
  // field that means "this row is now a real entry") and only while it's
  // still the last row, so it can't re-fire on every keystroke of a row
  // that's already been promoted, and other fields (qty/uom/remarks) never
  // trigger it on their own.
  const updateItemRow = (index: number, field: keyof ItemRow, value: FieldValue) =>
    setItemTableData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'item_name' && index === prev.length - 1 && String(value).trim()) {
        updated.push({ item_name: '', quantity: 1, uom: '', remarks: '' });
      }
      return updated;
    });

  const addServiceRow = () =>
    setServiceTableData(prev => [...prev, { description: '' }]);

  const removeServiceRow = (index: number) => {
    if (serviceTableData.length > 1) setServiceTableData(prev => prev.filter((_, i) => i !== index));
  };

  // Same auto-append behavior as updateItemRow, keyed off `description` since
  // that's a service row's only field.
  const updateServiceRow = (index: number, field: keyof ServiceRow, value: FieldValue) =>
    setServiceTableData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'description' && index === prev.length - 1 && String(value).trim()) {
        updated.push({ description: '' });
      }
      return updated;
    });

  // Submit handlers
  const handleItemSubmit = async (e: React.FormEvent, attachment?: File | null) => {
    e.preventDefault();
    log.info("Submitting item request — department:", itemFormData.department, "items:", itemTableData.length);
    try {
      const items = itemTableData.map(row => ({
        ...row,
        item_name: row.item_name.toUpperCase(),
        uom: row.uom.toUpperCase(),
        remarks: row.remarks.toUpperCase(), 
      }));

      const formData = new FormData();
      formData.append('department', itemFormData.department);
      formData.append('requested_by', itemFormData.requested_by);
      formData.append('request_type', itemFormData.request_type);
      formData.append('purpose', itemFormData.purpose.toUpperCase());
      formData.append('remarks', itemFormData.remarks.toUpperCase());
      formData.append('items', JSON.stringify(items));
      if (attachment) formData.append('attachment', attachment);

      if (attachment) setItemAttachmentUploadProgress(0);
      await createItemRequestAction(formData);
      log.info("Item request created successfully");
      setShowItemModal(false);
      setItemTableData([{ item_name: '', quantity: 1, uom: '', remarks: '' }]);
      loadRequests(true);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create item request:", reason);
      alert('Error submitting request: ' + reason);
    } finally {
      setItemAttachmentUploadProgress(null);
    }
  };

  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    log.info("Submitting service request — department:", serviceFormData.department, "services:", serviceTableData.length);
    try {
      await serviceRequestAPI.create({
        ...serviceFormData,
        purpose: serviceFormData.purpose.toUpperCase(),
        remarks: serviceFormData.remarks.toUpperCase(),
        services: serviceTableData.map(row => ({
          ...row,
          description: row.description.toUpperCase(),
        })),
      });
      log.info("Service request created successfully");
      setShowServiceModal(false);
      setServiceTableData([{ description: '' }]);
      loadRequests(true);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create service request:", reason);
      alert('Error submitting request: ' + reason);
    }
  };

  // Row selection handler
  const handleRowClick = useCallback(async (row: ItemRequest | ServiceRequest) => {
    const key = makeRequestKey(activeTab, row.id);
    const newExpandedRows = new Set<string>();
    if (!expandedRows.has(key)) {
      newExpandedRows.add(key);
      if (!requestDetails.has(key)) {
        try {
          const response = await fetchWithRetry(() =>
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
    setActiveTab('item');
    void handleRowClick(row);
  }, [deepLinkedRequest, itemRequests, handleRowClick]);

  // Approval/Rejection actions
  const handleActionChange = async (row: ItemRequest | ServiceRequest, action: string) => {
    if (action === 'approve') {
      if (!confirm('Are you sure you want to approve this request?')) return;
      log.info("Approving request #" + row.id, `(${activeTab})`);
      try {
        if (activeTab === 'item') await statusAPI.supervisorApproveItem(row.id, { status: 'approved' });
        else await statusAPI.supervisorApproveService(row.id, { status: 'approved' });
        log.info("Request #" + row.id, "approved");
        const key = makeRequestKey(activeTab, row.id);
        setRequestDetails(prev => { const next = new Map(prev); next.delete(key); return next; });
        setExpandedRows(prev => { const next = new Set(prev); next.delete(key); return next; });
        loadRequests(true);
      } catch (error: unknown) {
        const reason = getErrorMessage(error, 'Unable to approve request');
        log.error("Failed to approve request #" + row.id, reason);
        alert('Failed to approve request: ' + reason);
      }
    } else if (action === 'reject') {
      log.info("Opening reject modal for request #" + row.id);
      setRejectRequest(row);
      setRejectComment('');
      setShowRejectModal(true);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectRequest) return;
    try {
      if (activeTab === 'item') {
        await statusAPI.supervisorApproveItem(rejectRequest.id, { status: 'rejected', rejection_comment: rejectComment });
      } else {
        await statusAPI.supervisorApproveService(rejectRequest.id, { status: 'rejected', rejection_comment: rejectComment });
      }
      const rejectKey = makeRequestKey(activeTab, rejectRequest.id);
      setRequestDetails(prev => { const next = new Map(prev); next.delete(rejectKey); return next; });
      setExpandedRows(prev => { const next = new Set(prev); next.delete(rejectKey); return next; });
      setShowRejectModal(false);
      setRejectRequest(null);
      setRejectComment('');
      loadRequests(true);
    } catch (error: unknown) {
      const reason = getErrorMessage(error, 'Unable to decline request');
      log.error("Failed to decline request #" + rejectRequest.id, reason);
      alert('Failed to decline request: ' + reason);
    }
  };

  // Edit mode methods
  const toggleEditMode = (requestId: number, requestType?: RequestTab) => {
    if (requestType) {
      const details = requestDetails.get(makeRequestKey(requestType, requestId));
      if (details) {
        setEditableDetails(prev => new Map(prev).set(requestId, {
          purpose: details.purpose || '',
          remarks: details.remarks || '',
          items: details.items ? details.items.map((item: ItemRow) => ({ ...item })) : [],
          services: details.services ? details.services.map((service: ServiceRow) => ({ ...service })) : [],
        }));
        setEditingRequestId(requestId);
        setEditingRequestType(requestType);
        setShowEditModal(true);
      }
    } else {
      setShowEditModal(false);
      setEditingRequestId(null);
      setEditingRequestType('item');
      setEditableDetails(prev => {
        const next = new Map(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    const id = editingRequestId;
    setEditingRequestId(null);
    setEditableDetails(prev => {
      const next = new Map(prev);
      if (id) next.delete(id);
      return next;
    });
  };

  const updateDetailField = (requestId: number, field: string, value: string) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, { ...current, [field]: value });
    });

  const updateDetailItem = (requestId: number, index: number, field: keyof ItemRow, value: FieldValue) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      const updatedItems = [...current.items];
      updatedItems[index] = { ...updatedItems[index], [field]: value };
      return new Map(prev).set(requestId, { ...current, items: updatedItems });
    });

  const updateDetailService = (requestId: number, index: number, field: keyof ServiceRow, value: FieldValue) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      const updatedServices = [...current.services];
      updatedServices[index] = { ...updatedServices[index], [field]: value };
      return new Map(prev).set(requestId, { ...current, services: updatedServices });
    });

  const addDetailItem = (requestId: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        items: [...current.items, { item_name: '', quantity: 1, uom: '', remarks: '' }],
      });
    });

  const removeDetailItem = (requestId: number, index: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        items: current.items.filter((_, i) => i !== index),
      });
    });

  const addDetailService = (requestId: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        services: [...current.services, { description: '' }],
      });
    });

  const removeDetailService = (requestId: number, index: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        services: current.services.filter((_, i) => i !== index),
      });
    });

  const saveDetailChanges = async () => {
    if (!editingRequestId) return;
    const editable = editableDetails.get(editingRequestId);
    if (!editable) return;

    // Adjustment History: diff every existing item row (new, id-less rows
    // have no "before" to compare against) against its pre-edit snapshot in
    // requestDetails — editableDetails only ever holds the in-progress draft,
    // so requestDetails is still the last-saved copy at this point.
    let changes: AdjustmentChange[] = [];
    if (editingRequestType === 'item') {
      const originalItems = requestDetails.get(makeRequestKey('item', editingRequestId))?.items || [];
      changes = editable.items.flatMap((afterItem, index) => {
        if (afterItem.id === undefined) return [];
        const beforeItem = originalItems.find((i: ItemRow) => i.id === afterItem.id);
        if (!beforeItem) return [];
        return diffItemRow(beforeItem, afterItem, `Item #${index + 1} — ${afterItem.item_name || 'N/A'}`);
      });
    }
    let adjustmentRemarks = '';
    if (changes.length > 0) {
      const enteredRemarks = window.prompt('Enter Adjustment Remarks for this change:');
      if (enteredRemarks === null) return;
      adjustmentRemarks = enteredRemarks;
    }

    log.info("Saving edits for request #" + editingRequestId, `(${editingRequestType})`);
    try {
      if (editingRequestType === 'item') {
        await itemRequestAPI.update(editingRequestId, {
          purpose: editable.purpose,
          remarks: editable.remarks,
          items: editable.items,
          ...(changes.length > 0 ? { adjustment_remarks: adjustmentRemarks } : {}),
        });
      } else {
        await serviceRequestAPI.update(editingRequestId, {
          purpose: editable.purpose,
          remarks: editable.remarks,
          services: editable.services,
        });
      }
      log.info("Request #" + editingRequestId, "updated successfully");
      const response = await fetchWithRetry(() =>
        editingRequestType === 'item'
          ? itemRequestAPI.getById(editingRequestId)
          : serviceRequestAPI.getById(editingRequestId)
      );
      setRequestDetails(prev => new Map(prev).set(makeRequestKey(editingRequestType, editingRequestId), response.data));
      setEditableDetails(prev => {
        const next = new Map(prev);
        next.delete(editingRequestId);
        return next;
      });
      setShowEditModal(false);
      setEditingRequestId(null);
    } catch (error: unknown) {
      // Surfaces the server's reason (e.g. the request got reviewed while the
      // edit modal was open) instead of a generic message.
      const reason = getErrorMessage(error, 'Failed to save changes');
      log.error("Failed to save edits for request #" + editingRequestId, reason);
      alert('Failed to save changes: ' + reason);
    }
  };

  return {
    // Data
    itemRequests,
    serviceRequests,
    filteredItemRequests,
    filteredServiceRequests,
    requestDetails,
    setRequestDetails,
    editableDetails,
    expandedRows,
    isLoading,
    apiError,
    isSupervisor,
    canApproveRequest,

    // Filter state
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,

    // Create modal state
    showItemModal,
    setShowItemModal,
    showServiceModal,
    setShowServiceModal,

    // Reject modal state
    showRejectModal,
    setShowRejectModal,
    rejectComment,
    setRejectComment,

    // Edit modal state
    showEditModal,
    editingRequestId,
    editingRequestType,

    // Create form state
    itemFormData,
    setItemFormData,
    itemTableData,
    serviceFormData,
    setServiceFormData,
    serviceTableData,
    itemAttachmentUploadProgress,

    // Actions
    loadRequests,
    handleItemSubmit,
    handleServiceSubmit,
    handleRowClick,
    handleActionChange,
    handleRejectSubmit,
    canEditRequest,
    toggleEditMode,
    closeEditModal,
    updateDetailField,
    updateDetailItem,
    updateDetailService,
    addDetailItem,
    removeDetailItem,
    addDetailService,
    removeDetailService,
    saveDetailChanges,
    addItemRow,
    removeItemRow,
    updateItemRow,
    addServiceRow,
    removeServiceRow,
    updateServiceRow,
  };
};