import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "@shared/next-router";
import { sanitizeUserInput } from "@shared/utils/sanitize";
import { getCompositeStatus, getStatusBadgeClass, getItemStatusText, getItemStatusBadgeClass, getBsStatusBadgeClass } from "@shared/utils/status";
import Layout from "@shared/components/Layout";
import Modal from "@shared/components/Modal";
import DeleteReasonModal from "@shared/components/DeleteReasonModal";
import AdjustmentHistoryModal from "@features/adjustments/components/AdjustmentHistoryModal";
import ApprovalStatusPanel from "@features/requests/components/ApprovalStatusPanel";
import ReimbursementAttachmentLink from "@features/requests/components/ReimbursementAttachmentLink";
import { useAuth } from "@app/providers/AuthProvider";
import { useStaffRequests } from "@features/requests/hooks/useStaffRequests";
import { useUrgentRequests } from "@features/requests/hooks/useUrgentRequests";
import { useReimbursementRequests } from "@features/requests/hooks/useReimbursementRequests";
import { useAttachmentStorageUsage } from "@features/requests/hooks/useAttachmentStorageUsage";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import { itemRequestAPI } from "../../../services/api";
import { createLogger } from "@shared/utils/logger";
import { makeRequestKey } from "@shared/utils/requestKey";
import { UOM_OPTIONS } from "../../../constants/uom";
import { formatBytes } from "@shared/utils/formatBytes";
import IssuanceHistory from "@features/requests/components/IssuanceHistory";
import AttachmentDropzone, { SelectedFileChip } from "@features/requests/components/AttachmentDropzone";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { ItemExistenceBadge, ItemExistenceLegend } from "@shared/components/ItemExistenceStatus";
import { useItemCatalogEntries } from "@features/item-catalog/hooks/useItemCatalogEntries";
import { getItemExistenceStatus } from "@shared/utils/itemExistenceStatus";
import { getItemBalance } from "@shared/utils/itemBalance";
import { getErrorMessage } from "@shared/utils/errorMessage";
import { getMachineCodeError, isMachineCodeEnabled } from "@shared/utils/machineCodeValidation";
import { formatMilitaryTime, formatMilitaryDateTime } from "@shared/utils/format";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import ListToolbar from "@shared/components/ListToolbar";
import { exportToExcel } from "@shared/utils/exportExcel";
import type { RequestDetail, ItemRow } from "@shared/types";
import styles from "./Dashboard.module.css";


const log = createLogger("StaffDashboard");

const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  // Only a secretary submits requests on someone else's behalf — everyone
  // else's "Requested By" stays locked to their own name, same as before.
  const isSecretary = user?.role?.toLowerCase().trim() === "secretary";

  // Which department user is currently typed/picked in each modal's search
  // box — tracked separately from itemFormData/serviceFormData.requested_by,
  // which holds the already-formatted value ("X c/o Y") actually sent to the
  // server.
  const [itemRequesterName, setItemRequesterName] = useState<string>("");
  const [serviceRequesterName, setServiceRequesterName] = useState<string>("");
  useEffect(() => {
    if (user?.name) {
      setItemRequesterName(user.name);
      setServiceRequesterName(user.name);
    }
  }, [user?.name]);

  const formatRequestedBy = (selectedName: string): string =>
    (selectedName.trim().toUpperCase() === user?.name?.toUpperCase()
      ? selectedName
      : `${selectedName} c/o ${user?.name}`
    ).toUpperCase();

  useEffect(() => {
    log.info("Mounted — user:", user?.email, `(${user?.role})`);
    return () => {
      log.info("Unmounted");
    };
  }, [user]);

  const {
    filteredItemRequests,
    filteredServiceRequests,
    requestDetails,
    setRequestDetails,
    editableDetails,
    expandedRows,
    isLoading,
    apiError,
    isSupervisor,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    showRejectModal,
    setShowRejectModal,
    rejectComment,
    setRejectComment,
    showEditModal,
    editingRequestId,
    editingRequestType,
    itemFormData,
    setItemFormData,
    itemTableData,
    serviceFormData,
    setServiceFormData,
    serviceTableData,
    itemAttachmentUploadProgress,
    loadRequests,
    handleItemSubmit,
    handleServiceSubmit,
    handleRowClick,
    handleActionChange,
    handleRejectSubmit,
    canEditRequest,
    canApproveRequest,
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
    removeItemRow,
    updateItemRow,
    removeServiceRow,
    updateServiceRow,
  } = useStaffRequests();

  const {
    urgentFormData,
    setUrgentFormData,
    urgentItems,
    addUrgentItemRow,
    removeUrgentItemRow,
    updateUrgentItemRow,
    isSubmittingUrgent,
    submitUrgentRequest,
    urgentRequests,
    loadingUrgentRequests,
    expandedUrgentIds,
    toggleUrgentRow,
    reviewUrgentRequestAsSupervisor,
    canApproveUrgentAsSupervisor,
    setItemDeliveryStatus,
    savingItemDeliveryId,
  } = useUrgentRequests();
  const {
    reimbursementFormData,
    setReimbursementFormData,
    reimbursementItems,
    reimbursementAttachment,
    setReimbursementAttachment,
    addReimbursementItemRow,
    removeReimbursementItemRow,
    updateReimbursementItemRow,
    reimbursementTotalCost,
    isSubmittingReimbursement,
    submitReimbursementRequest,
    reimbursementRequests,
    loadingReimbursementRequests,
    expandedReimbursementIds,
    toggleReimbursementRow,
    reviewReimbursementAsSupervisor,
    canApproveReimbursementAsSupervisor,
  } = useReimbursementRequests();
  // Item tab only — the Urgent Request workflow (Phase 1, see the Urgent
  // Request plan) is item-focused; Create Service is unaffected.
  const [requestUrgency, setRequestUrgency] = useState<"non_urgent" | "urgent" | "reimbursement">("non_urgent");
  const [urgentDeclineTarget, setUrgentDeclineTarget] = useState<number | null>(null);
  const [showReimbursementPending, setShowReimbursementPending] = useState(false);
  const [reimbursementDeclineTarget, setReimbursementDeclineTarget] = useState<number | null>(null);
  // Delivery self-attestation editor — one urgent item row editable at a
  // time, mirroring PurchaserDashboard.tsx's transaction-type editor.
  const [editingDeliveryItemId, setEditingDeliveryItemId] = useState<number | null>(null);
  const [draftDeliveryStatus, setDraftDeliveryStatus] = useState<"pending" | "delivered" | "partial_delivered">("pending");
  const [draftQuantityDelivered, setDraftQuantityDelivered] = useState("");
  // Independent of viewMode/activeTab (kept "item"|"service" only, per the
  // rest of this hook/component) — a 5th tab overlaying the pending panels
  // rather than a 3rd activeTab value, to avoid rippling that type change
  // through every makeRequestKey(activeTab, ...) call in this file.
  const [showUrgentPending, setShowUrgentPending] = useState(false);

  const { usage: storageUsage, refetch: refetchStorageUsage } = useAttachmentStorageUsage();
  const machineCodeOptions = useMachineCodeOptions();
  const validMachineCodes = useMemo(
    () => new Set(machineCodeOptions.options.map((v) => v.toUpperCase())),
    [machineCodeOptions.options]
  );
  // Machine Code is Engineering-only — every other department's create form
  // renders the column disabled and skips its validation.
  const createMachineCodeEnabled = isMachineCodeEnabled(user?.department);
  // Edit form keys off the request's own department (not the viewer's), so a
  // supervisor editing another department's request sees the right state.
  const editMachineCodeEnabled = isMachineCodeEnabled(
    editingRequestId != null && editingRequestType
      ? requestDetails.get(makeRequestKey(editingRequestType, editingRequestId))?.department
      : user?.department
  );
  // Machine Code errors only render once the user has tried to submit —
  // showing "required" on a brand-new blank row before they've touched
  // anything would just be noise.
  const [itemSubmitAttempted, setItemSubmitAttempted] = useState(false);
  const [editSubmitAttempted, setEditSubmitAttempted] = useState(false);
  // "pending" shows the Item/Service Requests list for whichever of the two
  // activeTab picks; "create" shows that same tab's create form instead —
  // activeTab still drives which request list/form (and its makeRequestKey
  // lookups) is in view, this just layers "list vs. form" on top of it.
  // "all" is a third, read-only layer: a merged Item+Service list that
  // doesn't touch activeTab at all, so it can't disturb either tab's own
  // expand/edit state.
  const [searchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<"pending" | "create">(() =>
    searchParams.get("tab") === "create" ? "create" : "pending"
  );
  // Lets the sidebar's "Create New Request" link (/dashboard/staff?tab=create)
  // land straight on the create tab even when the dashboard was already mounted.
  useEffect(() => {
    if (searchParams.get("tab") === "create") setViewMode("create");
  }, [searchParams]);
  const allItemCatalogEntries = useItemCatalogEntries();
  // An item whose catalog entry lists specific departments is only offered
  // to those departments — unrestricted (null/empty departments) items stay
  // visible to everyone. Filtering the entries here (rather than after
  // deriving names/UoM below) means every downstream use — suggestions,
  // existence-status badges, UoM auto-fill — sees the same department-scoped
  // catalog automatically.
  const itemCatalogEntries = useMemo(
    () => allItemCatalogEntries.filter((entry) => {
      if (!entry.departments) return true;
      const allowed = entry.departments.split(",").map((d) => d.trim().toUpperCase());
      return allowed.includes((user?.department || "").toUpperCase());
    }),
    [allItemCatalogEntries, user?.department]
  );
  const itemCatalogNames = useMemo(
    () => Array.from(new Set(itemCatalogEntries.map((entry) => entry.item_name))).sort(),
    [itemCatalogEntries]
  );
  // Uppercase name -> its catalog UoM, so picking/typing an exact match can
  // auto-correct the UoM field to the real value instead of leaving it on
  // whatever the requester happened to pick.
  const itemCatalogUomByName = useMemo(
    () => new Map(itemCatalogEntries.map((entry) => [entry.item_name.toUpperCase(), entry.uom])),
    [itemCatalogEntries]
  );

  const [otherUomIndexes, setOtherUomIndexes] = useState<Set<number>>(new Set());
  const [editOtherUomIndexes, setEditOtherUomIndexes] = useState<Set<number>>(new Set());
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  // Requests whose "Drag & drop to replace" dropzone is currently expanded —
  // hidden by default when a file is already attached so it doesn't take up
  // space on every row that already has one.
  const [replaceOpenFor, setReplaceOpenFor] = useState<Set<number>>(new Set());
  const toggleReplaceOpen = (requestId: number) =>
    setReplaceOpenFor((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });

  // Percent (0-100) per request while its attachment replace-upload is in
  // flight — keyed so two rows uploading at once don't clobber each other.
  const [replaceAttachmentProgress, setReplaceAttachmentProgress] = useState<Map<number, number>>(new Map());
  const setReplaceProgressFor = (requestId: number, percent: number | null) =>
    setReplaceAttachmentProgress((prev) => {
      const next = new Map(prev);
      if (percent === null) next.delete(requestId);
      else next.set(requestId, percent);
      return next;
    });

  const syncOtherUomIndexes = (rows: ItemRow[]) => {
    const next = new Set<number>();
    rows.forEach((row, index) => {
      if (row.uom && !(UOM_OPTIONS as readonly string[]).includes(row.uom)) {
        next.add(index);
      }
    });
    return next;
  };

  // Mirrors what opening the old Item Request modal used to do — run when
  // the Create Item Requests tab is selected, so a stale "OTHER" UoM pick or
  // a previous submit's validation state doesn't leak into a fresh visit.
  const prepareItemCreateForm = () => {
    setOtherUomIndexes(syncOtherUomIndexes(itemTableData));
    setAttachmentFile(null);
    setItemSubmitAttempted(false);
  };

  const openEditModal = (requestId: number, requestType: "item" | "service") => {
    if (requestType === "item") {
      const items = requestDetails.get(makeRequestKey(requestType, requestId))?.items || [];
      setEditOtherUomIndexes(syncOtherUomIndexes(items));
    } else {
      setEditOtherUomIndexes(new Set());
    }
    setEditSubmitAttempted(false);
    toggleEditMode(requestId, requestType);
  };

  const isDangerous = (err: string) =>
    err.includes("expired") || err.includes("permission");

  // Dynamically imported — only needed once the user actually clicks Print.
  const handlePrint = async (requestId: number, requestType: "item" | "service") => {
    const details = requestDetails.get(makeRequestKey(requestType, requestId));
    if (details) {
      const { printRequestSlip } = await import("@features/requests/utils/print");
      printRequestSlip(details, requestType);
    }
  };

  // Exports whichever Pending list is active — mirrors CustodianDashboard's
  // export of the same Item/Service Requests shape.
  const handleExport = () =>
    activeTab === "item"
      ? exportToExcel(
          "pending-item-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "Status" },
          ],
          filteredItemRequests.map((row) => ({
            serial: row.serial || "",
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : "",
            created_by: row.created_by || "",
            department: row.department || "",
            purpose: row.purpose || "",
            status: getCompositeStatus(row as unknown as Record<string, unknown>).text,
          }))
        )
      : exportToExcel(
          "pending-service-requests",
          [
            { key: "serial", label: "Serial" },
            { key: "date", label: "Date" },
            { key: "created_by", label: "Created By" },
            { key: "department", label: "Department" },
            { key: "purpose", label: "Purpose" },
            { key: "status", label: "Status" },
          ],
          filteredServiceRequests.map((row) => ({
            serial: row.serial || "",
            date: row.created_at ? new Date(row.created_at as string).toISOString().split("T")[0] : "",
            created_by: row.created_by || "",
            department: row.department || "",
            purpose: row.purpose || "",
            status: getCompositeStatus(row).text,
          }))
        );

  // Which item request's Adjustment History modal is open, if any.
  const [historyRequestId, setHistoryRequestId] = useState<number | null>(null);

  const handleDownloadAttachment = async (id: number, _filename: string) => {
    try {
      const response = await itemRequestAPI.downloadAttachment(id);
      const url = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      alert("Failed to open attachment");
    }
  };

  const handleReplaceAttachment = async (id: number, file: File) => {
    setReplaceProgressFor(id, 0);
    try {
      await itemRequestAPI.replaceAttachment(id, file, (percent) => setReplaceProgressFor(id, percent));
      const response = await itemRequestAPI.getById(id);
      setRequestDetails((prev) =>
        new Map(prev).set(makeRequestKey(activeTab, id), response.data)
      );
      void refetchStorageUsage();
    } catch (error: unknown) {
      alert("Failed to replace attachment: " + getErrorMessage(error));
    } finally {
      setReplaceProgressFor(id, null);
    }
  };

  const handleDeleteAttachment = async (id: number, attachmentName: string) => {
    if (!confirm(`Remove "${attachmentName}" from this request?`)) return;
    try {
      await itemRequestAPI.deleteAttachment(id);
      const response = await itemRequestAPI.getById(id);
      setRequestDetails((prev) =>
        new Map(prev).set(makeRequestKey(activeTab, id), response.data)
      );
      void refetchStorageUsage();
    } catch (error: unknown) {
      alert("Failed to remove attachment: " + getErrorMessage(error));
    }
  };

  const canManageAttachment = (details: RequestDetail | undefined) =>
    !!details && (isSupervisor || user?.id === details.created_by);

  /** Shared attachment cell for the item/service detail panels — download link
   * (with file size, when known) plus, when the caller may manage it, a
   * styled upload/replace control and the shared storage-quota indicator. */
  const renderAttachmentField = (
    details: RequestDetail | undefined,
    requestId: number,
    canManage: boolean
  ) => {
    const usageRatio = storageUsage ? storageUsage.used / storageUsage.max : 0;
    return (
      <div className="col-12 col-sm-6 col-md">
        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
          Attachment
        </div>
        {details?.attachment_name ? (
          <div className="d-flex align-items-center gap-1">
            <button
              type="button"
              className="btn btn-link p-0 d-flex align-items-center gap-1 text-start"
              onClick={() => handleDownloadAttachment(requestId, details.attachment_name || "attachment.pdf")}
            >
              <i className="bi bi-file-earmark-pdf-fill" style={{ color: "#dc2626" }}></i>
              <span>{sanitizeUserInput(details.attachment_name || "Download")}</span>
              {typeof details.attachment_size === "number" && (
                <span className="text-muted" style={{ fontSize: "0.72rem" }}>
                  ({formatBytes(details.attachment_size)})
                </span>
              )}
            </button>
            {canManage && (
              <button
                type="button"
                className={styles.attachmentRemoveButton}
                onClick={() => handleDeleteAttachment(requestId, details.attachment_name || "this file")}
                title="Remove attachment"
                aria-label="Remove attachment"
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <div className="text-muted small">No attachment</div>
        )}
        {canManage && !replaceOpenFor.has(requestId) && (
          <button
            type="button"
            className="btn btn-link btn-sm p-0 mt-1"
            onClick={() => toggleReplaceOpen(requestId)}
          >
            {details?.attachment_name ? "Replace attachment" : "Add attachment"}
          </button>
        )}
        {replaceAttachmentProgress.has(requestId) && (
          <div className="mt-2">
            <div className={styles.storageBarTrack}>
              <div className={styles.storageBarFill} style={{ width: `${replaceAttachmentProgress.get(requestId)}%` }} />
            </div>
            <div className="text-muted" style={{ fontSize: "0.68rem" }}>
              Uploading… {replaceAttachmentProgress.get(requestId)}%
            </div>
          </div>
        )}
        {canManage && replaceOpenFor.has(requestId) && (
          <div className="mt-2">
            <AttachmentDropzone
              id={`attachment-upload-${requestId}`}
              compact
              label={details?.attachment_name ? "Drag & drop to replace" : "Drag & drop your file here"}
              onFileSelected={(file) => {
                toggleReplaceOpen(requestId);
                handleReplaceAttachment(requestId, file);
              }}
            />
            <button
              type="button"
              className="btn btn-link btn-sm p-0 mt-1"
              onClick={() => toggleReplaceOpen(requestId)}
            >
              Cancel
            </button>
            {storageUsage && (
              <>
                <div className={styles.storageBarTrack}>
                  <div
                    className={`${styles.storageBarFill} ${
                      usageRatio > 0.9
                        ? styles.storageBarFillDanger
                        : usageRatio > 0.7
                        ? styles.storageBarFillWarn
                        : ""
                    }`}
                    style={{ width: `${Math.min(100, usageRatio * 100)}%` }}
                  />
                </div>
                <div className="text-muted" style={{ fontSize: "0.68rem" }}>
                  {formatBytes(storageUsage.used)} of {formatBytes(storageUsage.max)} storage used
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderItemRequestForm = () => (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setItemSubmitAttempted(true);
      if (itemTableData.some((row) => Number.isNaN(row.quantity))) {
        alert("Please enter a Quantity for every item before submitting.");
        return;
      }
      if (createMachineCodeEnabled && !itemTableData.every((row) => getMachineCodeError(row.machine_code, validMachineCodes) === null)) {
        alert("Please resolve form errors before submitting.");
        return;
      }
      await handleItemSubmit(e, attachmentFile);
      void refetchStorageUsage();
    }}>
      <h1 className="h5 mb-3 center">REMINDER: ALWAYS PROVIDE COMPLETE AND SPECIFIC DETAILS WHEN SUBMITTING ITEM REQUESTS, WITH PARTICULAR EMPHASIS ON THE MATERIAL, MODEL, AND REQUIRED SIZE TO ENSURE ACCURATE IDENTIFICATION, PROCESSING, AND FULFILLMENT OF THE REQUESTED ITEM.</h1>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">DEPARTMENT</label>
          <input
            type="text"
            className="form-control"
            value={itemFormData.department}
            disabled
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REQUESTED BY</label>
          {isSecretary ? (
            <input
              type="text"
              className="form-control text-uppercase"
              value={itemRequesterName}
              onChange={(e) => {
                const value = e.target.value;
                setItemRequesterName(value);
                setItemFormData({ ...itemFormData, requested_by: formatRequestedBy(value) });
              }}
              placeholder="Type the requester's name…"
            />
          ) : (
            <input type="text" className="form-control" value={itemFormData.requested_by} disabled />
          )}
          {isSecretary && (
            <div className="form-text">
              Type the requester's name. If submitting on behalf, the system will automatically format as Requester c/o Your Name.
            </div>
          )}
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">PURPOSE / AREA / MACHINE CODE</label>
          <textarea
            className="form-control text-uppercase"
            value={itemFormData.purpose}
            onChange={(e) =>
              setItemFormData({ ...itemFormData, purpose: e.target.value })
            }
            rows={3}
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REMARKS</label>
          <textarea
            className="form-control text-uppercase"
            value={itemFormData.remarks}
            onChange={(e) =>
              setItemFormData({ ...itemFormData, remarks: e.target.value })
            }
            rows={3}
          />
        </div>
      </div>
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <h5 className="mb-0">ITEMS</h5>
          <ItemExistenceLegend />
        </div>
        <div className="table-responsive">
          <table className={`table table-bordered table-sm ${styles.itemsTable}`}>
            <thead className="table-light">
              <tr>
                <th className={styles.itemInputWidth}>Item Name </th>
                <th className={styles.quantityInput}>Quantity </th>
                <th className={styles.uomInput}>UoM </th>
                <th className={styles.remarksInput}>Remarks</th>
                <th className={styles.machineCodeInput}>Machine Code{createMachineCodeEnabled ? " *" : ""}</th>
                <th style={{ width: "80px" }}></th>
              </tr>
            </thead>
            <tbody>
              {itemTableData.map((row, index) => {
                const isOther = otherUomIndexes.has(index);
                const selectedUomValue = isOther
                  ? "OTHER"
                  : (UOM_OPTIONS as readonly string[]).includes(row.uom)
                  ? row.uom
                  : row.uom
                  ? "OTHER"
                  : "";
                const existenceStatus = getItemExistenceStatus(row.item_name, itemCatalogNames);
                // Once the name is an exact catalog match, the UoM is
                // fixed to that entry's real value — locked, not just
                // pre-filled, so it can't drift from the catalog again.
                const isUomLocked = existenceStatus === "existing";
                const machineCodeError = itemSubmitAttempted && createMachineCodeEnabled ? getMachineCodeError(row.machine_code, validMachineCodes) : null;
                const quantityError = itemSubmitAttempted && Number.isNaN(row.quantity)
                  ? "Quantity is required."
                  : null;

                return (
                  <tr key={index}>
                    <td data-label="Item Name">
                      <div>
                        <SearchableCombobox
                          className={`form-control form-control-sm text-uppercase ${styles.itemInputWidth}`}
                          value={row.item_name}
                          onChange={(value) => {
                            updateItemRow(index, "item_name", value);
                            // Exact catalog match: fix the UoM to the real value
                            // rather than leave it on whatever was picked before.
                            const matchedUom = itemCatalogUomByName.get(value.trim().toUpperCase());
                            if (matchedUom) {
                              updateItemRow(index, "uom", matchedUom);
                              setOtherUomIndexes((prev) => {
                                const next = new Set(prev);
                                if ((UOM_OPTIONS as readonly string[]).includes(matchedUom)) next.delete(index);
                                else next.add(index);
                                return next;
                              });
                            }
                          }}
                          options={itemCatalogNames}
                          placeholder="Search or type item name…"
                          required
                        />
                        <ItemExistenceBadge status={existenceStatus} />
                      </div>
                    </td>
                    <td data-label="Quantity">
                      <input
                        type="number"
                        min="1"
                        className={`form-control form-control-sm ${styles.quantityInput} ${quantityError ? "is-invalid" : ""}`}
                        value={Number.isNaN(row.quantity) ? "" : row.quantity}
                        onChange={(e) =>
                          updateItemRow(
                            index,
                            "quantity",
                            // Erasing the field must actually clear it (NaN, rendered
                            // as "") rather than snapping back to 1 — the previous
                            // behavior made it impossible to type a new value without
                            // a stray leading "1" (e.g. typing "12" became "112").
                            // A genuinely empty field is caught by quantityError below
                            // (and the required attribute) at submit time instead.
                            e.target.value === ""
                              ? NaN
                              : Math.max(1, parseInt(e.target.value) || 1)
                          )
                        }
                        required
                      />
                      {quantityError && (
                        <div className="invalid-feedback d-block">{quantityError}</div>
                      )}
                    </td>
                    <td data-label="UoM">
                      <select
                        className={`form-select form-select-sm text-uppercase ${styles.uomInput}`}
                        aria-label={`UoM for ${row.item_name || `item ${index + 1}`}`}
                        value={selectedUomValue}
                        onChange={(e) => {
                          const value = e.target.value;
                          setOtherUomIndexes((prev) => {
                            const next = new Set(prev);
                            if (value === "OTHER") {
                              next.add(index);
                            } else {
                              next.delete(index);
                            }
                            return next;
                          });
                          updateItemRow(
                            index,
                            "uom",
                            value === "OTHER" ? "" : value
                          );
                        }}
                        disabled={isUomLocked}
                        required
                      >
                        <option value="" disabled>
                          Select UoM
                        </option>
                        {UOM_OPTIONS.map((uom) => (
                          <option key={uom} value={uom}>
                            {uom}
                          </option>
                        ))}
                        <option value="OTHER">OTHER</option>
                      </select>
                      {isOther && !isUomLocked && (
                        <input
                          type="text"
                          className={`form-control form-control-sm text-uppercase mt-1 ${styles.uomInput}`}
                          placeholder="Specify UoM"
                          value={row.uom}
                          onChange={(e) =>
                            updateItemRow(index, "uom", e.target.value)
                          }
                          required
                        />
                      )}
                    </td>
                    <td data-label="Remarks">
                      <input
                        type="text"
                        className={`form-control form-control-sm text-uppercase ${styles.remarksInput}`}
                        value={row.remarks}
                        onChange={(e) =>
                          updateItemRow(index, "remarks", e.target.value)
                        }
                      />
                    </td>
                    <td data-label="Machine Code">
                      <SearchableCombobox
                        className={`form-control form-control-sm text-uppercase ${styles.machineCodeInput} ${machineCodeError ? "is-invalid" : ""}`}
                        value={row.machine_code || ""}
                        onChange={(value) => updateItemRow(index, "machine_code", value)}
                        options={machineCodeOptions.options}
                        descriptions={machineCodeOptions.descriptions}
                        placeholder={createMachineCodeEnabled ? "Search or type…" : "N/A"}
                        noResultsText="No record found"
                        required={createMachineCodeEnabled}
                        disabled={!createMachineCodeEnabled}
                      />
                      {machineCodeError && (
                        <div className="invalid-feedback d-block">{machineCodeError}</div>
                      )}
                    </td>
                    <td className="text-center">
                      {itemTableData.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setOtherUomIndexes((prev) => {
                              const next = new Set(prev);
                              next.delete(index);
                              return next;
                            });
                            removeItemRow(index);
                          }}
                          className="btn btn-sm btn-danger"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label d-block">PDF Attachment · Max 10.5MB</label>
        <AttachmentDropzone
          id="create-item-attachment"
          label={attachmentFile ? "Drag & drop to replace" : "Drag & Drop your file here"}
          onFileSelected={setAttachmentFile}
        />
        {attachmentFile && (
          <SelectedFileChip file={attachmentFile} onRemove={() => setAttachmentFile(null)} />
        )}
        {itemAttachmentUploadProgress !== null && (
          <div className="mt-1">
            <div className="text-muted" style={{ fontSize: "0.68rem" }}>
              Uploading PDF…
            </div>
          </div>
        )}
        {storageUsage && (
          <div style={{ maxWidth: "220px" }}>
            <div className={styles.storageBarTrack}>
              <div
                className={`${styles.storageBarFill} ${
                  storageUsage.used / storageUsage.max > 0.9
                    ? styles.storageBarFillDanger
                    : storageUsage.used / storageUsage.max > 0.7
                    ? styles.storageBarFillWarn
                    : ""
                }`}
                style={{ width: `${Math.min(100, (storageUsage.used / storageUsage.max) * 100)}%` }}
              />
            </div>
            <div className="text-muted" style={{ fontSize: "0.68rem" }}>
              {formatBytes(storageUsage.used)} of {formatBytes(storageUsage.max)} storage used
            </div>
          </div>
        )}
      </div>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={itemAttachmentUploadProgress !== null}
      >
        {itemAttachmentUploadProgress !== null ? "Uploading…" : "Submit Request"}
      </button>
    </form>
  );

  /**
   * Urgent Request workflow, Phase 1 — free-style items (no catalog lookup,
   * no machine code), an Inventoriable/Not toggle per item, and no
   * attachment. Submits to useUrgentRequests() instead of useStaffRequests(),
   * a separate table with its own Stockroom (Custodian) review step — see
   * the Urgent Request plan for the full picture.
   */
  const startEditingDelivery = (item: { id?: number; delivery_status?: "pending" | "delivered" | "partial_delivered"; quantity_delivered?: number | null }) => {
    if (!item.id) return;
    setEditingDeliveryItemId(item.id);
    setDraftDeliveryStatus(item.delivery_status || "pending");
    setDraftQuantityDelivered(item.quantity_delivered != null ? String(item.quantity_delivered) : "");
  };

  const cancelEditingDelivery = () => {
    setEditingDeliveryItemId(null);
    setDraftDeliveryStatus("pending");
    setDraftQuantityDelivered("");
  };

  const saveEditingDelivery = async (requestId: number) => {
    if (!editingDeliveryItemId) return;
    if (draftDeliveryStatus !== "pending" && (!draftQuantityDelivered || Number(draftQuantityDelivered) < 0)) {
      alert("Enter a valid quantity delivered.");
      return;
    }
    const ok = await setItemDeliveryStatus(
      requestId,
      editingDeliveryItemId,
      draftDeliveryStatus,
      draftDeliveryStatus !== "pending" ? Number(draftQuantityDelivered) : undefined
    );
    if (ok) cancelEditingDelivery();
  };

  const renderUrgentRequestForm = () => (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const ok = await submitUrgentRequest();
      if (ok) setRequestUrgency("non_urgent");
    }}>
      <h1 className="h5 mb-3 center">URGENT REQUEST: ENTER ITEMS FREE-STYLE. STOCKROOM WILL CLASSIFY EACH ONE INVENTORIABLE OR NOT DURING REVIEW.</h1>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">DEPARTMENT</label>
          <input type="text" className="form-control" value={urgentFormData.department} disabled />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REQUESTED BY</label>
          {isSecretary ? (
            <input
              type="text"
              className="form-control text-uppercase"
              value={itemRequesterName}
              onChange={(e) => {
                const value = e.target.value;
                setItemRequesterName(value);
                setUrgentFormData({ ...urgentFormData, requested_by: formatRequestedBy(value) });
              }}
              placeholder="Type the requester's name…"
            />
          ) : (
            <input type="text" className="form-control" value={urgentFormData.requested_by} disabled />
          )}
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">PURPOSE</label>
          <textarea
            className="form-control text-uppercase"
            value={urgentFormData.purpose}
            onChange={(e) => setUrgentFormData({ ...urgentFormData, purpose: e.target.value })}
            rows={3}
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REMARKS</label>
          <textarea
            className="form-control text-uppercase"
            value={urgentFormData.remarks}
            onChange={(e) => setUrgentFormData({ ...urgentFormData, remarks: e.target.value })}
            rows={3}
          />
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">DATE NEEDED</label>
          <input
            type="date"
            className="form-control"
            value={urgentFormData.date_needed}
            onChange={(e) => setUrgentFormData({ ...urgentFormData, date_needed: e.target.value })}
          />
        </div>
      </div>

      <div className="table-responsive mb-3">
        <table className="table table-sm">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Item Description</th>
              <th style={{ width: "15%" }}>Qty</th>
              <th style={{ width: "25%" }}>UoM</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {urgentItems.map((item, index) => (
              <tr key={index}>
                <td>
                  <SearchableCombobox
                    className="form-control form-control-sm text-uppercase"
                    value={item.item_description}
                    onChange={(value) => updateUrgentItemRow(index, "item_description", value)}
                    options={itemCatalogNames}
                    placeholder="Search or type item name…"
                    required
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="form-control form-control-sm"
                    value={item.quantity ?? ""}
                    onChange={(e) => updateUrgentItemRow(index, "quantity", e.target.value ? Number(e.target.value) : undefined)}
                  />
                </td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    value={item.uom || ""}
                    onChange={(e) => updateUrgentItemRow(index, "uom", e.target.value)}
                  >
                    <option value="">Select UoM</option>
                    {UOM_OPTIONS.map((uom) => (
                      <option key={uom} value={uom}>{uom}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => removeUrgentItemRow(index)}
                    disabled={urgentItems.length === 1}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addUrgentItemRow}>
          <i className="bi bi-plus-lg me-1"></i>Add Item
        </button>
      </div>

      <button type="submit" className="btn btn-primary" disabled={isSubmittingUrgent}>
        {isSubmittingUrgent ? "Submitting…" : "Submit Urgent Request"}
      </button>
    </form>
  );

  /**
   * Reimbursement Request workflow — free-style items like the Urgent
   * Request form above, plus a request-level Supplier and a per-item
   * Amount (both entered by the requester up front, unlike Urgent Request's
   * later Purchaser classification step) and a computed Total Cost. Goes to
   * Supervisor/Manager, then Purchaser, then AP Officer.
   */
  const renderReimbursementRequestForm = () => (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const ok = await submitReimbursementRequest();
      if (ok) setRequestUrgency("non_urgent");
    }}>
      <h1 className="h5 mb-3 center">REIMBURSEMENT REQUEST: ENTER THE SUPPLIER AND EACH ITEM'S AMOUNT. GOES TO SUPERVISOR/MANAGER, THEN PURCHASER, THEN AP OFFICER.</h1>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">DEPARTMENT</label>
          <input type="text" className="form-control" value={reimbursementFormData.department} disabled />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REQUESTED BY</label>
          {isSecretary ? (
            <input
              type="text"
              className="form-control text-uppercase"
              value={itemRequesterName}
              onChange={(e) => {
                const value = e.target.value;
                setItemRequesterName(value);
                setReimbursementFormData({ ...reimbursementFormData, requested_by: formatRequestedBy(value) });
              }}
              placeholder="Type the requester's name…"
            />
          ) : (
            <input type="text" className="form-control" value={reimbursementFormData.requested_by} disabled />
          )}
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">SUPPLIER</label>
          <input
            type="text"
            className="form-control text-uppercase"
            value={reimbursementFormData.supplier}
            onChange={(e) => setReimbursementFormData({ ...reimbursementFormData, supplier: e.target.value })}
            placeholder="Who was paid for this purchase…"
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">DATE NEEDED</label>
          <input
            type="date"
            className="form-control"
            value={reimbursementFormData.date_needed}
            onChange={(e) => setReimbursementFormData({ ...reimbursementFormData, date_needed: e.target.value })}
          />
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">PURPOSE</label>
          <textarea
            className="form-control text-uppercase"
            value={reimbursementFormData.purpose}
            onChange={(e) => setReimbursementFormData({ ...reimbursementFormData, purpose: e.target.value })}
            rows={3}
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">REMARKS</label>
          <textarea
            className="form-control text-uppercase"
            value={reimbursementFormData.remarks}
            onChange={(e) => setReimbursementFormData({ ...reimbursementFormData, remarks: e.target.value })}
            rows={3}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label">SUPPORTING DOCUMENT (PDF, MAX 10 MB)</label>
        <AttachmentDropzone
          id="reimbursement-attachment"
          accept="application/pdf,.pdf"
          label="Add a supporting PDF"
          maxSizeMB={10}
          onFileSelected={setReimbursementAttachment}
        />
        {reimbursementAttachment && (
          <SelectedFileChip
            file={reimbursementAttachment}
            onRemove={() => setReimbursementAttachment(null)}
          />
        )}
      </div>

      <div className="table-responsive mb-3">
        <table className="table table-sm">
          <thead>
            <tr>
              <th style={{ width: "32%" }}>Item Description</th>
              <th style={{ width: "12%" }}>Qty</th>
              <th style={{ width: "20%" }}>UoM</th>
              <th style={{ width: "18%" }}>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reimbursementItems.map((item, index) => (
              <tr key={index}>
                <td>
                  <SearchableCombobox
                    className="form-control form-control-sm text-uppercase"
                    value={item.item_description}
                    onChange={(value) => updateReimbursementItemRow(index, "item_description", value)}
                    options={itemCatalogNames}
                    placeholder="Search or type item name…"
                    required
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="form-control form-control-sm"
                    value={item.quantity ?? ""}
                    onChange={(e) => updateReimbursementItemRow(index, "quantity", e.target.value ? Number(e.target.value) : undefined)}
                  />
                </td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    value={item.uom || ""}
                    onChange={(e) => updateReimbursementItemRow(index, "uom", e.target.value)}
                  >
                    <option value="">Select UoM</option>
                    {UOM_OPTIONS.map((uom) => (
                      <option key={uom} value={uom}>{uom}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="form-control form-control-sm"
                    value={item.amount}
                    onChange={(e) => updateReimbursementItemRow(index, "amount", e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => removeReimbursementItemRow(index)}
                    disabled={reimbursementItems.length === 1}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="text-end fw-bold" colSpan={3}>Total Cost:</td>
              <td className="fw-bold">₱{reimbursementTotalCost.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addReimbursementItemRow}>
          <i className="bi bi-plus-lg me-1"></i>Add Item
        </button>
      </div>

      <button type="submit" className="btn btn-primary" disabled={isSubmittingReimbursement}>
        {isSubmittingReimbursement ? "Submitting…" : "Submit Reimbursement Request"}
      </button>
    </form>
  );

  const renderServiceRequestForm = () => (
    <form onSubmit={handleServiceSubmit}>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">Department</label>
          <input
            type="text"
            className="form-control"
            value={serviceFormData.department}
            disabled
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">Requested By</label>
          {isSecretary ? (
            <input
              type="text"
              className="form-control text-uppercase"
              value={serviceRequesterName}
              onChange={(e) => {
                const value = e.target.value;
                setServiceRequesterName(value);
                setServiceFormData({ ...serviceFormData, requested_by: formatRequestedBy(value) });
              }}
              placeholder="Type the requester's name…"
            />
          ) : (
            <input type="text" className="form-control" value={serviceFormData.requested_by} disabled />
          )}
          {isSecretary && (
            <div className="form-text">
              Type the requester's name. If submitting on behalf, the system will automatically format as Requester c/o Your Name.
            </div>
          )}
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label">Purpose *</label>
          <textarea
            className="form-control text-uppercase"
            value={serviceFormData.purpose}
            onChange={(e) =>
              setServiceFormData({ ...serviceFormData, purpose: e.target.value })
            }
            rows={3}
            required
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">Remarks</label>
          <textarea
            className="form-control text-uppercase"
            value={serviceFormData.remarks}
            onChange={(e) =>
              setServiceFormData({ ...serviceFormData, remarks: e.target.value })
            }
            rows={3}
          />
        </div>
      </div>
      <div className="mb-3">
        <h5 className="mb-3">Services Requested</h5>
        <div className="table-responsive">
          <table className="table table-bordered table-sm">
            <thead className="table-light">
              <tr>
                <th className={styles.serviceDescriptionTextarea}>
                  Service Description *
                </th>
                <th style={{ width: "80px" }}></th>
              </tr>
            </thead>
            <tbody>
              {serviceTableData.map((row, index) => (
                <tr key={index}>
                  <td>
                    <textarea
                      className={`form-control form-control-sm text-uppercase ${styles.serviceDescriptionTextarea}`}
                      value={row.description}
                      onChange={(e) =>
                        updateServiceRow(index, "description", e.target.value)
                      }
                      required
                      rows={2}
                    />
                  </td>
                  <td className="text-center">
                    {serviceTableData.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeServiceRow(index)}
                        className="btn btn-sm btn-danger"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button type="submit" className="btn btn-primary">
        Submit Request
      </button>
    </form>
  );

  return (
    <Layout>
      <div className="page-header">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h1 className="page-title">My Requests</h1>
            <p className="page-subtitle">{user?.department}</p>
          </div>
          {apiError && (
            <div
              className={`alert ${styles.errorBanner} ${
                isDangerous(apiError)
                  ? styles.errorBannerDanger
                  : styles.errorBannerWarning
              }`}
            >
              <i
                className={`bi ${
                  isDangerous(apiError)
                    ? "bi-shield-exclamation"
                    : "bi-exclamation-triangle"
                } me-2`}
              ></i>
              {apiError}
              <button
                className={`btn btn-sm ${
                  isDangerous(apiError)
                    ? "btn-outline-danger"
                    : "btn-outline-warning"
                } ms-2`}
                onClick={() => loadRequests(true)}
                style={{ fontSize: "12px", padding: "2px 8px" }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {viewMode === "pending" && !showUrgentPending && (
        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Serial, Purpose, PR Number..."
          onExport={handleExport}
          exportDisabled={(activeTab === "item" ? filteredItemRequests : filteredServiceRequests).length === 0}
        />
      )}

      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingCard}>
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-2 mb-0">Loading requests...</p>
          </div>
        </div>
      )}

      <div className="dash-tabs mb-4">
                <button
          className={`dash-tab ${!showUrgentPending && !showReimbursementPending && viewMode === "create" && activeTab === "item" ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: create item requests");
            setShowUrgentPending(false);
            setShowReimbursementPending(false);
            setViewMode("create");
            setActiveTab("item");
            prepareItemCreateForm();
          }}
        >
          Create Item
        </button>
        <button
          className={`dash-tab ${!showUrgentPending && !showReimbursementPending && viewMode === "create" && activeTab === "service" ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: create service requests");
            setShowUrgentPending(false);
            setShowReimbursementPending(false);
            setViewMode("create");
            setActiveTab("service");
          }}
        >
          Create Service
        </button>
        <button
          className={`dash-tab ${!showUrgentPending && !showReimbursementPending && viewMode === "pending" && activeTab === "item" ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: pending item requests");
            setShowUrgentPending(false);
            setShowReimbursementPending(false);
            setViewMode("pending");
            setActiveTab("item");
          }}
        >
          Pending Item Requests
          <span className="dash-tab-badge">{filteredItemRequests.length}</span>
        </button>
        <button
          className={`dash-tab ${!showUrgentPending && !showReimbursementPending && viewMode === "pending" && activeTab === "service" ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: pending service requests");
            setShowUrgentPending(false);
            setShowReimbursementPending(false);
            setViewMode("pending");
            setActiveTab("service");
          }}
        >
          Pending Service Requests
          <span className="dash-tab-badge">{filteredServiceRequests.length}</span>
        </button>
        <button
          className={`dash-tab ${showUrgentPending ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: pending urgent requests");
            setShowReimbursementPending(false);
            setShowUrgentPending(true);
          }}
        >
          Pending Urgent Requests
          <span className="dash-tab-badge">{urgentRequests.length}</span>
        </button>
        <button
          className={`dash-tab ${showReimbursementPending ? "active" : ""}`}
          onClick={() => {
            log.info("Tab switched to: pending reimbursement requests");
            setShowUrgentPending(false);
            setShowReimbursementPending(true);
          }}
        >
          Pending Reimbursement Requests
          <span className="dash-tab-badge">{reimbursementRequests.length}</span>
        </button>

      </div>

      <div className="mb-4">
        <DateRangeFilter />
      </div>

      {showUrgentPending ? (
        <div className={styles.requestListFrame}>
          <div className={styles.urgentListHeader}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Department</div>
            <div>Purpose</div>
            <div>Status</div>
          </div>
          <div>
            {loadingUrgentRequests && <div className="p-3 text-muted">Loading urgent requests...</div>}
            {!loadingUrgentRequests && urgentRequests.length === 0 && (
              <div className="text-center py-5" style={{ color: "#9ca3af" }}>
                <i className="bi bi-inbox" style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}></i>
                No urgent requests found.
              </div>
            )}
            {urgentRequests.map((row) => {
              const expanded = expandedUrgentIds.has(row.id);
              return (
                <div key={row.id} className={styles.requestCard}>
                  <div
                    className={`${styles.urgentListRow} ${expanded ? styles.urgentListRowExpanded : ""}`}
                    onClick={() => toggleUrgentRow(row.id)}
                  >
                    <div className="text-center">
                      <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                    </div>
                    <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                    <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                    <div data-label="Dept">{row.department}</div>
                    <div data-label="Purpose">{row.purpose}</div>
                    <div data-label="Status">
                      <span className={`badge ${getBsStatusBadgeClass(row.stockroom_status === "approved" ? "approved" : row.supervisor_status)}`}>
                        {row.supervisor_status === "rejected"
                          ? "Declined (Supervisor)"
                          : row.stockroom_status === "rejected"
                          ? "Declined (Stockroom)"
                          : row.stockroom_status === "approved"
                          ? "Approved"
                          : row.supervisor_status === "approved"
                          ? "Approved (Supervisor)"
                          : "Pending"}
                      </span>
                    </div>
                  </div>

                  <div className={`${styles.expandWrapper} ${expanded ? styles.expandWrapperOpen : ""}`}>
                    <div className={styles.expandInner}>
                      {expanded && (
                        <div className={styles.requestCardBody}>
                          <div className="p-3">
                            {row.requested_by && (
                              <div className="mb-2 small text-muted">Requested by: {row.requested_by}</div>
                            )}
                            {row.date_needed && (
                              <div className="mb-2 small text-muted">Date Needed: {new Date(row.date_needed).toLocaleDateString()}</div>
                            )}
                            {row.remarks && (
                              <div className="mb-2 small text-muted">Remarks: {sanitizeUserInput(row.remarks)}</div>
                            )}
                            <table className="table table-sm mt-2 mb-3">
                              <thead>
                                <tr>
                                  <th>Item Description</th>
                                  <th>Quantity</th>
                                  <th>UoM</th>
                                  <th>Inventoriable</th>
                                  <th>Delivery Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item, idx) => {
                                  const isEditingDelivery = editingDeliveryItemId === item.id;
                                  return (
                                    <tr key={item.id ?? idx}>
                                      <td>{item.item_description}</td>
                                      <td>{item.quantity ?? ""}</td>
                                      <td>{item.uom ?? ""}</td>
                                      <td>{item.is_inventoriable ? "Yes" : "No"}</td>
                                      <td>
                                        {item.is_inventoriable ? (
                                          <span className="text-muted">—</span>
                                        ) : isEditingDelivery ? (
                                          <div className="d-flex flex-wrap gap-2 align-items-center">
                                            <select
                                              className="form-select form-select-sm"
                                              style={{ width: "150px" }}
                                              value={draftDeliveryStatus}
                                              onChange={(e) => setDraftDeliveryStatus(e.target.value as "pending" | "delivered" | "partial_delivered")}
                                            >
                                              <option value="pending">Pending</option>
                                              <option value="delivered">Delivered</option>
                                              <option value="partial_delivered">Partial Delivered</option>
                                            </select>
                                            {draftDeliveryStatus !== "pending" && (
                                              <input
                                                type="number"
                                                min="0"
                                                className="form-control form-control-sm"
                                                style={{ width: "90px" }}
                                                placeholder="Qty"
                                                value={draftQuantityDelivered}
                                                onChange={(e) => setDraftQuantityDelivered(e.target.value)}
                                              />
                                            )}
                                            <button
                                              className="btn btn-sm btn-success"
                                              disabled={savingItemDeliveryId === item.id}
                                              onClick={() => saveEditingDelivery(row.id)}
                                            >
                                              Save
                                            </button>
                                            <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditingDelivery}>
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="d-flex align-items-center gap-2">
                                            <span
                                              className={`badge ${
                                                item.delivery_status === "delivered"
                                                  ? "bg-success"
                                                  : item.delivery_status === "partial_delivered"
                                                  ? "bg-warning text-dark"
                                                  : "bg-secondary"
                                              }`}
                                            >
                                              {item.delivery_status === "delivered"
                                                ? "Delivered"
                                                : item.delivery_status === "partial_delivered"
                                                ? `Partial (${item.quantity_delivered ?? 0})`
                                                : "Pending"}
                                            </span>
                                            <button className="btn btn-sm btn-link text-decoration-none p-0" style={{ fontSize: "0.8rem" }} onClick={() => startEditingDelivery(item)}>
                                              {item.delivery_status && item.delivery_status !== "pending" ? "Change" : "Set"}
                                            </button>
                                          </div>
                                        )}
                                        {!item.is_inventoriable && item.delivered_by_name && (
                                          <div className="small text-muted mt-1">
                                            {item.delivered_by_name}
                                            {item.delivered_at ? ` — ${new Date(item.delivered_at).toLocaleDateString()}` : ""}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>

                            <ApprovalStatusPanel
                              supervisorLabel="Supervisor And Manager"
                              supervisorStatus={row.supervisor_status}
                              supervisorApprovedByName={row.supervisor_approved_by_name}
                              supervisorApprovedAt={row.supervisor_approved_at}
                              custodianLabel="Stockroom"
                              custodianStatus={row.stockroom_status}
                              custodianApprovedByName={row.stockroom_approved_by_name}
                              custodianApprovedAt={row.stockroom_approved_at}
                              rejectionComment={row.rejection_comment}
                            />

                            {/* Supervisor/Manager can act directly from here — this is
                                where they land by default (ROLE_REDIRECT_MAP), same as
                                the item/service Quick Action above. */}
                            {row.supervisor_status === "pending" && isSupervisor && (
                              canApproveUrgentAsSupervisor(row) ? (
                                <div className="d-flex gap-2">
                                  <button
                                    className="btn btn-sm btn-success"
                                    onClick={() => reviewUrgentRequestAsSupervisor(row.id, "approved")}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={() => setUrgentDeclineTarget(row.id)}
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <span className="text-muted small">Awaiting manager approval</span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : showReimbursementPending ? (
        <div className={styles.requestListFrame}>
          <div className={`${styles.urgentListHeader} ${styles.urgentListHeaderAmount}`}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Department</div>
            <div>Supplier</div>
            <div>Total Amount</div>
            <div>Status</div>
          </div>
          <div>
            {loadingReimbursementRequests && <div className="p-3 text-muted">Loading reimbursement requests...</div>}
            {!loadingReimbursementRequests && reimbursementRequests.length === 0 && (
              <div className="text-center py-5" style={{ color: "#9ca3af" }}>
                <i className="bi bi-inbox" style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}></i>
                No reimbursement requests found.
              </div>
            )}
            {reimbursementRequests.map((row) => {
              const expanded = expandedReimbursementIds.has(row.id);
              return (
                <div key={row.id} className={styles.requestCard}>
                  <div
                    className={`${styles.urgentListRow} ${styles.urgentListRowAmount} ${expanded ? styles.urgentListRowExpanded : ""}`}
                    onClick={() => toggleReimbursementRow(row.id)}
                  >
                    <div className="text-center">
                      <i className={`bi bi-chevron-${expanded ? "down" : "right"}`}></i>
                    </div>
                    <div className={styles.serialLink} data-label="Serial">{row.serial}</div>
                    <div className="text-muted" data-label="Date">{row.created_at ? formatMilitaryDateTime(row.created_at) : ""}</div>
                    <div data-label="Dept">{row.department}</div>
                    <div data-label="Supplier">{row.supplier}</div>
                    <div data-label="Total Amount">₱{Number(row.total_cost).toFixed(2)}</div>
                    <div data-label="Status">
                      <span className={`badge ${getBsStatusBadgeClass(row.ap_status === "closed" ? "closed" : row.ap_status === "approved" ? "approved" : row.purchaser_status === "approved" ? "approved" : row.supervisor_status)}`}>
                        {row.supervisor_status === "rejected"
                          ? "Declined (Supervisor)"
                          : row.purchaser_status === "rejected"
                          ? "Declined (Purchaser)"
                          : row.ap_status === "rejected"
                          ? "Declined (AP Officer)"
                          : row.ap_status === "closed"
                          ? "Closed"
                          : row.ap_status === "approved"
                          ? "Approved"
                          : row.purchaser_status === "approved"
                          ? "Approved (Purchaser)"
                          : row.supervisor_status === "approved"
                          ? "Approved (Supervisor)"
                          : "Pending"}
                      </span>
                    </div>
                  </div>

                  <div className={`${styles.expandWrapper} ${expanded ? styles.expandWrapperOpen : ""}`}>
                    <div className={styles.expandInner}>
                      {expanded && (
                        <div className={styles.requestCardBody}>
                          <div className="p-3">
                            {row.requested_by && (
                              <div className="mb-2 small text-muted">Requested by: {row.requested_by}</div>
                            )}
                            {row.date_needed && (
                              <div className="mb-2 small text-muted">Date Needed: {new Date(row.date_needed).toLocaleDateString()}</div>
                            )}
                            {row.remarks && (
                              <div className="mb-2 small text-muted">Remarks: {sanitizeUserInput(row.remarks)}</div>
                            )}

                            <ReimbursementAttachmentLink
                              requestId={row.id}
                              attachmentName={row.attachment_name}
                              attachmentSize={row.attachment_size}
                            />

                            <table className="table table-sm mt-2 mb-3">
                              <thead>
                                <tr>
                                  <th>Item Description</th>
                                  <th>Quantity</th>
                                  <th>UoM</th>
                                  <th className="text-end">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item, idx) => (
                                  <tr key={item.id ?? idx}>
                                    <td>{item.item_description}</td>
                                    <td>{item.quantity ?? ""}</td>
                                    <td>{item.uom ?? ""}</td>
                                    <td className="text-end">₱{Number(item.amount).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <td className="text-end fw-bold" colSpan={3}>Total Cost:</td>
                                  <td className="text-end fw-bold">₱{Number(row.total_cost).toFixed(2)}</td>
                                </tr>
                              </tfoot>
                            </table>

                            <ApprovalStatusPanel
                              supervisorLabel="Supervisor And Manager"
                              supervisorStatus={row.supervisor_status}
                              supervisorApprovedByName={row.supervisor_approved_by_name}
                              supervisorApprovedAt={row.supervisor_approved_at}
                              custodianLabel="Purchaser"
                              custodianStatus={row.purchaser_status}
                              custodianApprovedByName={row.purchaser_approved_by_name}
                              custodianApprovedAt={row.purchaser_approved_at}
                              thirdLabel="AP Officer"
                              thirdStatus={row.ap_status}
                              thirdApprovedByName={row.ap_approved_by_name}
                              thirdApprovedAt={row.ap_approved_at}
                              rejectionComment={row.rejection_comment}
                            />

                            {row.supervisor_status === "pending" && isSupervisor && (
                              canApproveReimbursementAsSupervisor(row) ? (
                                <div className="d-flex gap-2">
                                  <button
                                    className="btn btn-sm btn-success"
                                    onClick={() => reviewReimbursementAsSupervisor(row.id, "approved")}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={() => setReimbursementDeclineTarget(row.id)}
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <span className="text-muted small">Awaiting manager approval</span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === "create" ? (
        <div className={styles.requestListFrame}>
          <div className="p-4">
            {activeTab === "item" && (
              <div className="mb-3" style={{ maxWidth: "320px" }}>
                <label className="form-label">Request Type</label>
                <select
                  className="form-select"
                  value={requestUrgency}
                  onChange={(e) => setRequestUrgency(e.target.value as "non_urgent" | "urgent" | "reimbursement")}
                >
                  <option value="non_urgent">Non-Urgent Request</option>
                  <option value="urgent">Urgent Request</option>
                  <option value="reimbursement">Reimbursement</option>
                </select>
              </div>
            )}
            {activeTab === "item"
              ? (requestUrgency === "urgent" ? renderUrgentRequestForm() : requestUrgency === "reimbursement" ? renderReimbursementRequestForm() : renderItemRequestForm())
              : renderServiceRequestForm()}
          </div>
        </div>
      ) : activeTab === "item" ? (
        <div className={styles.requestListFrame}>
          <div className={styles.requestListHeader}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Created By</div>
            <div>Department</div>
            <div>Purpose</div>
            <div>Status</div>
          </div>
          {filteredItemRequests.length === 0 ? (
            <div className="text-center py-5" style={{ color: "#9ca3af" }}>
              <i
                className="bi bi-inbox"
                style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}
              ></i>
              No item requests found.
            </div>
          ) : (
            filteredItemRequests.map((row) => (
              <div key={row.id} className={styles.requestCard}>
                <div
                  className={`${styles.requestCardRow} ${
                    expandedRows.has(makeRequestKey(activeTab, row.id))
                      ? styles.requestCardRowExpanded
                      : ""
                  }`}
                  onClick={() => handleRowClick(row)}
                >
                  <div className="text-center">
                    <i
                      className={`bi bi-chevron-${
                        expandedRows.has(makeRequestKey(activeTab, row.id))
                          ? "down"
                          : "right"
                      }`}
                    ></i>
                  </div>
                  <div className="fw-medium" data-label="Serial">
                    {row.serial}
                  </div>
                  <div className="text-muted" data-label="Date">
                    {row.created_at
                      ? new Date(row.created_at).toISOString().split("T")[0]
                      : ""}
                  </div>
                  <div className="hide-sm" data-label="By">
                    {row.created_by}
                  </div>
                  <div className="hide-sm" data-label="Dept">
                    {row.department}
                  </div>
                  <div data-label="Purpose">{row.purpose}</div>
                  <div>
                    {(() => {
                      const s = getCompositeStatus(row as unknown as Record<string, unknown>);
                      return (
                        <span className={`badge ${getStatusBadgeClass(s.class)}`}>
                          {s.text}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div
                  className={`${styles.expandWrapper} ${
                    expandedRows.has(makeRequestKey(activeTab, row.id))
                      ? styles.expandWrapperOpen
                      : ""
                  }`}
                >
                  <div className={styles.expandInner}>
                    {requestDetails.has(makeRequestKey(activeTab, row.id)) && (
                      <div className={styles.requestCardBody}>
                        <div className="p-3">
                          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                            <h5 className="mb-0">Request Details</h5>
                            <div className="d-flex flex-wrap gap-2 align-items-center">
                              {canApproveRequest(row) &&
                                row.status === "pending" &&
                                row.supervisor_status !== "approved" &&
                                row.supervisor_status !== "rejected" && (
                                  <div onClick={(e) => e.stopPropagation()}>
                                    <select
                                      className="form-select form-select-sm"
                                      style={{ width: "130px" }}
                                      value=""
                                      onChange={(e) => {
                                        const action = e.target.value;
                                        (e.target as HTMLSelectElement).value = "";
                                        handleActionChange(row, action);
                                      }}
                                    >
                                      <option value="">Quick Action</option>
                                      <option value="approve">Approve</option>
                                      <option value="reject">Decline</option>
                                    </select>
                                  </div>
                                )}
                              {!canApproveRequest(row) &&
                                isSupervisor &&
                                row.created_by_role?.toLowerCase() === "supervisor" &&
                                row.status === "pending" &&
                                row.supervisor_status !== "approved" &&
                                row.supervisor_status !== "rejected" && (
                                  <span className="text-muted small">
                                    Awaiting manager approval
                                  </span>
                                )}
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handlePrint(row.id, "item")}
                              >
                                <i className="bi bi-printer me-1"></i>Print IRS
                              </button>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => setHistoryRequestId(row.id)}
                              >
                                <i className="bi bi-clock-history me-1"></i>Adjustment History
                              </button>
                              {canEditRequest(
                                requestDetails.get(makeRequestKey(activeTab, row.id))
                              ) && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => openEditModal(row.id, "item")}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="border rounded p-3 mb-3 bg-light">
                            <div className="fw-semibold text-secondary small text-uppercase mb-3">
                              Request Information
                            </div>
                            <div className="row g-3">
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Serial
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.serial}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Created Time
                                </div>
                                <div className="fw-semibold">
                                  {formatMilitaryTime(requestDetails.get(makeRequestKey(activeTab, row.id))?.created_at)}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Department
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.department}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Requested By
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.requested_by || "—"}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Status
                                </div>
                                <span
                                  className={`badge ${getStatusBadgeClass(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.status
                                  )}`}
                                >
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.status}
                                </span>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Remarks
                                </div>
                                <div>
                                  {sanitizeUserInput(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.remarks || "—"
                                  )}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Purpose
                                </div>
                                <div>
                                  {sanitizeUserInput(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.purpose || "—"
                                  )}
                                </div>
                              </div>
                              {(requestDetails.get(makeRequestKey(activeTab, row.id))?.attachment_name ||
                                canManageAttachment(
                                  requestDetails.get(makeRequestKey(activeTab, row.id))
                                )) &&
                                renderAttachmentField(
                                  requestDetails.get(makeRequestKey(activeTab, row.id)),
                                  row.id,
                                  canManageAttachment(requestDetails.get(makeRequestKey(activeTab, row.id)))
                                )}
                            </div>
                          </div>

                          <ApprovalStatusPanel
                            supervisorLabel="Supervisor And Manager"
                            supervisorStatus={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_status}
                            supervisorApprovedByName={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_name || requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_approved_by_name}
                            supervisorApprovedAt={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_approved_at}
                            custodianStatus={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_status}
                            custodianApprovedByName={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_name || requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_approved_by_name}
                            custodianApprovedAt={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_approved_at}
                            rejectionComment={requestDetails.get(makeRequestKey(activeTab, row.id))?.rejection_comment}
                          />

                          <hr className="my-3" />
                          <h5 className="mb-3">Items</h5>
                          <div className="table-responsive">
                            <table
                              className={`table table-sm ${styles.itemsTable}`}
                              style={{
                                borderCollapse: "separate",
                                borderSpacing: "0",
                                border: "1px solid #e0e0e0",
                                borderRadius: "8px",
                                overflow: "hidden",
                              }}
                            >
                              <thead style={{ backgroundColor: "#f8f9fa" }}>
                                <tr>
                                  {["#", "Item Name", "Qty", "UoM", "Remarks", "Machine Code", "Balance", "Existence Status", "Status", "Details"].map(
                                    (label) => (
                                      <th
                                        key={label}
                                        style={{
                                          padding: "12px",
                                          border: "none",
                                          borderBottom: "1px solid #e0e0e0",
                                          fontWeight: "600",
                                          color: "#495057",
                                        }}
                                      >
                                        {label}
                                      </th>
                                    )
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {requestDetails
                                  .get(makeRequestKey(activeTab, row.id))
                                  ?.items?.map((item: ItemRow, index: number) => (
                                    <tr
                                      key={index}
                                      style={{
                                        backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa",
                                      }}
                                    >
                                      <td data-label="#" style={{ padding: "12px", border: "none" }}>
                                        {index + 1}
                                      </td>
                                      <td data-label="Item Name" style={{ padding: "12px", border: "none" }}>
                                        {sanitizeUserInput(item.item_name || "")}
                                      </td>
                                      <td data-label="Qty" style={{ padding: "12px", border: "none" }}>
                                        {item.quantity}
                                      </td>
                                      <td data-label="UoM" style={{ padding: "12px", border: "none" }}>
                                        {sanitizeUserInput(item.uom || "")}
                                      </td>
                                      <td data-label="Remarks" style={{ padding: "12px", border: "none" }}>
                                        {sanitizeUserInput(item.remarks || "N/A")}
                                      </td>
                                      <td data-label="Machine Code" style={{ padding: "12px", border: "none" }}>
                                        {sanitizeUserInput(item.machine_code || "N/A")}
                                      </td>
                                      <td data-label="Balance" style={{ padding: "12px", border: "none" }}>
                                        {getItemBalance(item)}
                                      </td>
                                      <td data-label="Existence Status" style={{ padding: "12px", border: "none" }}>
                                        <ItemExistenceBadge status={getItemExistenceStatus(item.item_name, itemCatalogNames)} />
                                      </td>
                                      <td data-label="Status" style={{ padding: "12px", border: "none" }}>
                                        <span className={`badge ${getItemStatusBadgeClass(item)}`}>
                                          {getItemStatusText(item)}
                                        </span>
                                      </td>
                                      <td data-label="Details" style={{ padding: "12px", border: "none" }}>
                                        {item.delivery_status ? (
                                          <div className="table-responsive">
                                            <table
                                              className="table table-sm mb-0"
                                              style={{
                                                borderCollapse: "separate",
                                                borderSpacing: "0",
                                                border: "1px solid #dee2e6",
                                                borderRadius: "6px",
                                                overflow: "hidden",
                                                backgroundColor: "#fafbfc",
                                              }}
                                            >
                                              <tbody>
                                                {item.delivery_status === "OUT" && (
                                                  <>
                                                    <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                      <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>
                                                        Issuance No.
                                                      </td>
                                                      <td style={{ padding: "8px 12px", border: "none", color: "#212529" }}>
                                                        {item.issuance_number || "Not issued yet"}
                                                      </td>
                                                    </tr>
                                                    <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                      <td style={{ width: "110px", padding: "8px 12px", border: "none", backgroundColor: "#f8f9fa", fontWeight: "500", color: "#6c757d" }}>
                                                        Qty Out
                                                      </td>
                                                      <td style={{ padding: "8px 12px", border: "none", color: "#212529" }}>
                                                        {item.quantity_out ?? 0} / {item.quantity}
                                                      </td>
                                                    </tr>
                                                  </>
                                                )}
                                                {(item.delivery_status === "PURCHASE REQUEST" ||
                                                  item.delivery_status === "URGENT") && (
                                                  <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                    <td
                                                      style={{
                                                        width: "110px",
                                                        padding: "8px 12px",
                                                        border: "none",
                                                        backgroundColor: "#f8f9fa",
                                                        fontWeight: "500",
                                                        color: "#6c757d",
                                                      }}
                                                    >
                                                      {item.delivery_status === "URGENT" ? "Date Needed" : "PR Number"}
                                                    </td>
                                                    <td style={{ padding: "8px 12px", border: "none", color: "#212529" }}>
                                                      {item.delivery_status === "URGENT" ? (item.date_needed ? new Date(item.date_needed).toLocaleDateString() : "N/A") : (item.pr_number || "N/A")}
                                                    </td>
                                                  </tr>
                                                )}
                                                {(item.delivery_status === "PURCHASE REQUEST" ||
                                                  item.delivery_status === "URGENT") &&
                                                  item.pr_status && (
                                                    <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                      <td
                                                        style={{
                                                          width: "110px",
                                                          padding: "8px 12px",
                                                          border: "none",
                                                          backgroundColor: "#f8f9fa",
                                                          fontWeight: "500",
                                                          color: "#6c757d",
                                                        }}
                                                      >
                                                        Order Status
                                                      </td>
                                                      <td style={{ padding: "8px 12px", border: "none", color: "#212529" }}>
                                                        {item.pr_status}
                                                      </td>
                                                    </tr>
                                                  )}
                                                {/* Issuance No. and Qty Out are not repeated here — the
                                                    Qty Out history below lists every release with its own
                                                    number, so a summary row only duplicated the last one. */}
                                                {item.audits && item.audits.length > 0 && (
                                                  <tr>
                                                    <td colSpan={2} style={{ padding: "0", border: "none" }}>
                                                      <IssuanceHistory audits={item.audits} prNumber={(item.pr_type || item.delivery_status) === "URGENT" ? (item.date_needed ? new Date(item.date_needed).toLocaleDateString() : null) : item.pr_number} prNumberLabel={(item.pr_type || item.delivery_status) === "URGENT" ? "Date Needed" : "PR Number"} showPrNumber={user?.role?.toLowerCase().trim() === "admin"} />
                                                    </td>
                                                  </tr>
                                                )}
                                                {(item.delivery_status === "PARTIAL DELIVERED" ||
                                                  ((item.delivery_status === "PURCHASE REQUEST" ||
                                                    item.delivery_status === "URGENT") &&
                                                    item.pr_status === "DELIVERED PARTIAL")) && (
                                                  <tr style={{ borderBottom: "1px solid #dee2e6" }}>
                                                    <td
                                                      style={{
                                                        width: "110px",
                                                        padding: "8px 12px",
                                                        border: "none",
                                                        backgroundColor: "#f8f9fa",
                                                        fontWeight: "500",
                                                        color: "#6c757d",
                                                      }}
                                                    >
                                                      Qty Delivered
                                                    </td>
                                                    <td style={{ padding: "8px 12px", border: "none", color: "#212529" }}>
                                                      {item.quantity_delivered || "N/A"}
                                                    </td>
                                                  </tr>
                                                )}
                                                {item.delivery_status === "DELIVERED" && (
                                                  <tr>
                                                    <td
                                                      colSpan={2}
                                                      className="text-center"
                                                      style={{ padding: "8px 12px", border: "none", color: "#6c757d" }}
                                                    >
                                                      -
                                                    </td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : (
                                          <span className="text-muted">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className={styles.requestListFrame}>
          <div className={styles.requestListHeader}>
            <div></div>
            <div>Serial Number</div>
            <div>Created Date</div>
            <div>Created By</div>
            <div>Department</div>
            <div>Purpose</div>
            <div>Status</div>
          </div>
          {filteredServiceRequests.length === 0 ? (
            <div className="text-center py-5" style={{ color: "#9ca3af" }}>
              <i
                className="bi bi-inbox"
                style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}
              ></i>
              No service requests found.
            </div>
          ) : (
            filteredServiceRequests.map((row) => (
              <div key={row.id} className={styles.requestCard}>
                <div
                  className={`${styles.requestCardRow} ${
                    expandedRows.has(makeRequestKey(activeTab, row.id))
                      ? styles.requestCardRowExpanded
                      : ""
                  }`}
                  onClick={() => handleRowClick(row)}
                >
                  <div className="text-center">
                    <i
                      className={`bi bi-chevron-${
                        expandedRows.has(makeRequestKey(activeTab, row.id))
                          ? "down"
                          : "right"
                      }`}
                    ></i>
                  </div>
                  <div className="fw-medium" data-label="Serial">
                    {row.serial}
                  </div>
                  <div className="text-muted" data-label="Date">
                    {row.created_at
                      ? new Date(row.created_at).toISOString().split("T")[0]
                      : ""}
                  </div>
                  <div className="hide-sm" data-label="By">
                    {row.created_by}
                  </div>
                  <div className="hide-sm" data-label="Dept">
                    {row.department}
                  </div>
                  <div data-label="Purpose">{row.purpose}</div>
                  <div>
                    {(() => {
                      const s = getCompositeStatus(row as unknown as Record<string, unknown>);
                      return (
                        <span className={`badge ${getStatusBadgeClass(s.class)}`}>
                          {s.text}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div
                  className={`${styles.expandWrapper} ${
                    expandedRows.has(makeRequestKey(activeTab, row.id))
                      ? styles.expandWrapperOpen
                      : ""
                  }`}
                >
                  <div className={styles.expandInner}>
                    {requestDetails.has(makeRequestKey(activeTab, row.id)) && (
                      <div className={styles.requestCardBody}>
                        <div className="p-3">
                          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                            <h5 className="mb-0">Request Details</h5>
                            <div className="d-flex flex-wrap gap-2 align-items-center">
                              {canApproveRequest(row) &&
                                row.status === "pending" &&
                                row.supervisor_status !== "approved" &&
                                row.supervisor_status !== "rejected" && (
                                  <div onClick={(e) => e.stopPropagation()}>
                                    <select
                                      className="form-select form-select-sm"
                                      style={{ width: "130px" }}
                                      value=""
                                      onChange={(e) => {
                                        const action = e.target.value;
                                        (e.target as HTMLSelectElement).value = "";
                                        handleActionChange(row, action);
                                      }}
                                    >
                                      <option value="">Quick Action</option>
                                      <option value="approve">Approve</option>
                                      <option value="reject">Decline</option>
                                    </select>
                                  </div>
                                )}
                              {!canApproveRequest(row) &&
                                isSupervisor &&
                                (row.created_by_role?.toLowerCase() === "manager" ||
                                  row.created_by_role?.toLowerCase() === "supervisor") &&
                                row.status === "pending" &&
                                row.supervisor_status !== "approved" &&
                                row.supervisor_status !== "rejected" && (
                                  <span className="text-muted small">
                                    Awaiting manager approval
                                  </span>
                                )}

                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handlePrint(row.id, "service")}
                              >
                                <i className="bi bi-printer me-1"></i>Print SRS
                              </button>
                              {canEditRequest(
                                requestDetails.get(makeRequestKey(activeTab, row.id))
                              ) && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => openEditModal(row.id, "service")}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="border rounded p-3 mb-3 bg-light">
                            <div className="fw-semibold text-secondary small text-uppercase mb-3">
                              Request Information
                            </div>
                            <div className="row g-3">
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Serial
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.serial}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Created Time
                                </div>
                                <div className="fw-semibold">
                                  {formatMilitaryTime(requestDetails.get(makeRequestKey(activeTab, row.id))?.created_at)}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Department
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.department}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Requested By
                                </div>
                                <div className="fw-semibold">
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.requested_by || "—"}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Status
                                </div>
                                <span
                                  className={`badge ${getStatusBadgeClass(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.status
                                  )}`}
                                >
                                  {requestDetails.get(makeRequestKey(activeTab, row.id))?.status}
                                </span>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Remarks
                                </div>
                                <div>
                                  {sanitizeUserInput(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.remarks || "—"
                                  )}
                                </div>
                              </div>
                              <div className="col-12 col-sm-6 col-md">
                                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                  Purpose
                                </div>
                                <div>
                                  {sanitizeUserInput(
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.purpose || "—"
                                  )}
                                </div>
                              </div>
                              {requestDetails.get(makeRequestKey(activeTab, row.id))?.attachment_name &&
                                renderAttachmentField(
                                  requestDetails.get(makeRequestKey(activeTab, row.id)),
                                  row.id,
                                  isSupervisor &&
                                    requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_status !==
                                      "approved"
                                )}
                            </div>
                          </div>

                          <ApprovalStatusPanel
                            supervisorStatus={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_status}
                            supervisorApprovedByName={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_name || requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_approved_by_name}
                            supervisorApprovedAt={requestDetails.get(makeRequestKey(activeTab, row.id))?.supervisor_approved_at}
                            custodianStatus={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_status}
                            custodianApprovedByName={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_name || requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_approved_by_name}
                            custodianApprovedAt={requestDetails.get(makeRequestKey(activeTab, row.id))?.custodian_approved_at}
                            rejectionComment={requestDetails.get(makeRequestKey(activeTab, row.id))?.rejection_comment}
                          />

                          {(requestDetails.get(makeRequestKey(activeTab, row.id))?.pr_number ||
                            requestDetails.get(makeRequestKey(activeTab, row.id))?.pr_status) && (
                            <div className="border rounded p-3 mb-3">
                              <div className="fw-semibold text-secondary small text-uppercase mb-3">
                                Purchase Request
                              </div>
                              <div className="row g-3">
                                <div className="col-12 col-sm-6">
                                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                    PR Number
                                  </div>
                                  <div>
                                    {requestDetails.get(makeRequestKey(activeTab, row.id))?.pr_number || "—"}
                                  </div>
                                </div>
                                <div className="col-12 col-sm-6">
                                  <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                    Order Status
                                  </div>
                                  <div>
                                    {requestDetails.get(makeRequestKey(activeTab, row.id))?.pr_status || "—"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          <hr className="my-3" />
                          <h5 className="mb-3">Services</h5>
                          <div className="table-responsive">
                            <table
                              className={`table table-sm ${styles.itemsTable}`}
                              style={{
                                borderCollapse: "separate",
                                borderSpacing: "0",
                                border: "1px solid #e0e0e0",
                                borderRadius: "8px",
                                overflow: "hidden",
                              }}
                            >
                              <thead style={{ backgroundColor: "#f8f9fa" }}>
                                <tr>
                                  {["#", "Description"].map((label) => (
                                    <th
                                      key={label}
                                      style={{
                                        padding: "12px",
                                        border: "none",
                                        borderBottom: "1px solid #e0e0e0",
                                        fontWeight: "600",
                                        color: "#495057",
                                      }}
                                    >
                                      {label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {requestDetails
                                  .get(makeRequestKey(activeTab, row.id))
                                  ?.services?.map((service: { description?: string }, index: number) => (
                                    <tr
                                      key={index}
                                      style={{
                                        backgroundColor: index % 2 === 0 ? "#ffffff" : "#f8f9fa",
                                        borderBottom: "1px solid #e0e0e6",
                                      }}
                                    >
                                      <td data-label="#" style={{ padding: "12px", border: "none" }}>
                                        {index + 1}
                                      </td>
                                      <td data-label="Description" style={{ padding: "12px", border: "none" }}>
                                        {sanitizeUserInput(service.description || "")}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Decline Modal */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => {
          setShowRejectModal(false);
          setRejectComment("");
        }}
        title="Decline Request"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRejectSubmit();
          }}
        >
          <div className="mb-3">
            <label className="form-label">
              Declined Comment <span className="text-danger">*</span>
            </label>
            <textarea
              className="form-control text-uppercase"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              required
              rows={3}
              placeholder="Enter reason for declining..."
            />
          </div>
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-danger">
              Decline
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowRejectModal(false);
                setRejectComment("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={closeEditModal}
        title={`Edit ${
          editingRequestType === "item" ? "Item" : "Service"
        } Request`}
      >
        {editingRequestId && editableDetails.has(editingRequestId) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditSubmitAttempted(true);
              if (editingRequestType === "item") {
                const items = editableDetails.get(editingRequestId)?.items || [];
                if (items.some((row) => Number.isNaN(row.quantity))) {
                  alert("Please enter a Quantity for every item before submitting.");
                  return;
                }
                if (editMachineCodeEnabled && !items.every((row) => getMachineCodeError(row.machine_code, validMachineCodes) === null)) {
                  alert("Please resolve form errors before submitting.");
                  return;
                }
              }
              saveDetailChanges();
            }}
          >
            <div className="mb-3">
              <label className="form-label">Serial</label>
              <input
                type="text"
                className="form-control"
                value={
                  requestDetails.get(
                    makeRequestKey(editingRequestType, editingRequestId)
                  )?.serial || ""
                }
                disabled
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Department</label>
              <input
                type="text"
                className="form-control"
                value={
                  requestDetails.get(
                    makeRequestKey(editingRequestType, editingRequestId)
                  )?.department || ""
                }
                disabled
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Purpose *</label>
              <textarea
                className="form-control text-uppercase"
                value={editableDetails.get(editingRequestId)?.purpose || ""}
                onChange={(e) =>
                  updateDetailField(editingRequestId, "purpose", e.target.value)
                }
                required
                rows={3}
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Remarks</label>
              <textarea
                className="form-control text-uppercase"
                value={editableDetails.get(editingRequestId)?.remarks || ""}
                onChange={(e) =>
                  updateDetailField(editingRequestId, "remarks", e.target.value)
                }
                rows={2}
              />
            </div>
            <div className="mb-3">
              <h5 className="mb-3">
                {editingRequestType === "item" ? "Items" : "Services"}
              </h5>
              <div className="table-responsive">
                <table className={`table table-bordered table-sm ${styles.itemsTable}`}>
                  <thead className="table-light">
                    <tr>
                      {editingRequestType === "item" ? (
                        <>
                          <th className={styles.itemInputWidth}>Item Name *</th>
                          <th className={styles.quantityInput}>Quantity *</th>
                          <th className={styles.uomInput}>UoM *</th>
                          <th className={styles.remarksInput}>Remarks</th>
                          <th className={styles.machineCodeInput}>Machine Code{editMachineCodeEnabled ? " *" : ""}</th>
                          <th style={{ width: "80px" }}></th>
                        </>
                      ) : (
                        <>
                          <th className={styles.serviceDescriptionTextarea}>
                            Service Description *
                          </th>
                          <th style={{ width: "80px" }}></th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(editingRequestType === "item"
                      ? editableDetails.get(editingRequestId)?.items
                      : editableDetails.get(editingRequestId)?.services
                    )?.map((rawRow: ItemRow | { description?: string }, index: number) => {
                      if (editingRequestType === "item") {
                        const row = rawRow as ItemRow;
                        const isOther = editOtherUomIndexes.has(index);
                        const selectedUomValue = isOther
                          ? "OTHER"
                          : (UOM_OPTIONS as readonly string[]).includes(row.uom)
                          ? row.uom
                          : row.uom
                          ? "OTHER"
                          : "";
                        const existenceStatus = getItemExistenceStatus(row.item_name || "", itemCatalogNames);
                        const isUomLocked = existenceStatus === "existing";
                        const machineCodeError = editSubmitAttempted && editMachineCodeEnabled ? getMachineCodeError(row.machine_code, validMachineCodes) : null;
                        const quantityError = editSubmitAttempted && Number.isNaN(row.quantity)
                          ? "Quantity is required."
                          : null;

                        return (
                          <tr key={index}>
                            <td data-label="Item Name">
                              <div>
                                <SearchableCombobox
                                  className={`form-control form-control-sm text-uppercase ${styles.itemInputWidth}`}
                                  value={row.item_name || ""}
                                  onChange={(value) => {
                                    updateDetailItem(editingRequestId, index, "item_name", value);
                                    const matchedUom = itemCatalogUomByName.get(value.trim().toUpperCase());
                                    if (matchedUom) {
                                      updateDetailItem(editingRequestId, index, "uom", matchedUom);
                                      setEditOtherUomIndexes((prev) => {
                                        const next = new Set(prev);
                                        if ((UOM_OPTIONS as readonly string[]).includes(matchedUom)) next.delete(index);
                                        else next.add(index);
                                        return next;
                                      });
                                    }
                                  }}
                                  options={itemCatalogNames}
                                  placeholder="Search or type item name…"
                                  required
                                />
                                <ItemExistenceBadge status={existenceStatus} />
                              </div>
                            </td>
                            <td data-label="Quantity">
                              <input
                                type="number"
                                min="1"
                                className={`form-control form-control-sm ${styles.quantityInput} ${quantityError ? "is-invalid" : ""}`}
                                value={Number.isNaN(row.quantity) ? "" : row.quantity}
                                onChange={(e) =>
                                  updateDetailItem(
                                    editingRequestId,
                                    index,
                                    "quantity",
                                    e.target.value === ""
                                      ? NaN
                                      : Math.max(1, parseInt(e.target.value) || 1)
                                  )
                                }
                                required
                              />
                              {quantityError && (
                                <div className="invalid-feedback d-block">{quantityError}</div>
                              )}
                            </td>
                            <td data-label="UoM">
                              <select
                                className={`form-select form-select-sm text-uppercase ${styles.uomInput}`}
                                aria-label={`UoM for ${row.item_name || `item ${index + 1}`}`}
                                value={selectedUomValue}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEditOtherUomIndexes((prev) => {
                                    const next = new Set(prev);
                                    if (value === "OTHER") {
                                      next.add(index);
                                    } else {
                                      next.delete(index);
                                    }
                                    return next;
                                  });
                                  updateDetailItem(
                                    editingRequestId,
                                    index,
                                    "uom",
                                    value === "OTHER" ? "" : value
                                  );
                                }}
                                disabled={isUomLocked}
                                required
                              >
                                <option value="" disabled>
                                  Select UoM
                                </option>
                                {UOM_OPTIONS.map((uom) => (
                                  <option key={uom} value={uom}>
                                    {uom}
                                  </option>
                                ))}
                                <option value="OTHER">OTHER</option>
                              </select>
                              {isOther && !isUomLocked && (
                                <input
                                  type="text"
                                  className={`form-control form-control-sm text-uppercase mt-1 ${styles.uomInput}`}
                                  placeholder="Specify UoM"
                                  value={row.uom || ""}
                                  onChange={(e) =>
                                    updateDetailItem(
                                      editingRequestId,
                                      index,
                                      "uom",
                                      e.target.value
                                    )
                                  }
                                  required
                                />
                              )}
                            </td>
                            <td data-label="Remarks">
                              <input
                                type="text"
                                className={`form-control form-control-sm text-uppercase ${styles.remarksInput}`}
                                value={row.remarks || ""}
                                onChange={(e) =>
                                  updateDetailItem(
                                    editingRequestId,
                                    index,
                                    "remarks",
                                    e.target.value
                                  )
                                }
                              />
                            </td>
                            <td data-label="Machine Code">
                              <SearchableCombobox
                                className={`form-control form-control-sm text-uppercase ${styles.machineCodeInput} ${machineCodeError ? "is-invalid" : ""}`}
                                value={row.machine_code || ""}
                                onChange={(value) => updateDetailItem(editingRequestId, index, "machine_code", value)}
                                options={machineCodeOptions.options}
                                descriptions={machineCodeOptions.descriptions}
                                placeholder={editMachineCodeEnabled ? "Search or type…" : "N/A"}
                                noResultsText="No record found"
                                required={editMachineCodeEnabled}
                                disabled={!editMachineCodeEnabled}
                              />
                              {machineCodeError && (
                                <div className="invalid-feedback d-block">{machineCodeError}</div>
                              )}
                            </td>
                            <td className="text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditOtherUomIndexes((prev) => {
                                    const next = new Set(prev);
                                    next.delete(index);
                                    return next;
                                  });
                                  removeDetailItem(editingRequestId, index);
                                }}
                                className="btn btn-sm btn-danger"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      }

                      const row = rawRow as { description?: string };
                      return (
                        <tr key={index}>
                          <td data-label="Description">
                            <textarea
                              className={`form-control form-control-sm text-uppercase ${styles.serviceDescriptionTextarea}`}
                              value={row.description || ""}
                              onChange={(e) =>
                                updateDetailService(
                                  editingRequestId,
                                  index,
                                  "description",
                                  e.target.value
                                )
                              }
                              required
                              rows={2}
                            />
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              onClick={() =>
                                removeDetailService(editingRequestId, index)
                              }
                              className="btn btn-sm btn-danger"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() =>
                  editingRequestType === "item"
                    ? addDetailItem(editingRequestId)
                    : addDetailService(editingRequestId)
                }
                className="btn btn-sm btn-secondary"
              >
                + Add {editingRequestType === "item" ? "Item" : "Service"}
              </button>
            </div>
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary">
                Save Changes
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeEditModal}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      <AdjustmentHistoryModal
        isOpen={historyRequestId !== null}
        onClose={() => setHistoryRequestId(null)}
        requestId={historyRequestId}
      />

      <DeleteReasonModal
        isOpen={urgentDeclineTarget !== null}
        title="Decline Urgent Request"
        onClose={() => setUrgentDeclineTarget(null)}
        onConfirm={(reason) => {
          if (urgentDeclineTarget !== null) reviewUrgentRequestAsSupervisor(urgentDeclineTarget, "rejected", reason);
          setUrgentDeclineTarget(null);
        }}
      />

      <DeleteReasonModal
        isOpen={reimbursementDeclineTarget !== null}
        title="Decline Reimbursement Request"
        onClose={() => setReimbursementDeclineTarget(null)}
        onConfirm={(reason) => {
          if (reimbursementDeclineTarget !== null) reviewReimbursementAsSupervisor(reimbursementDeclineTarget, "rejected", reason);
          setReimbursementDeclineTarget(null);
        }}
      />
    </Layout>
  );
};

export default StaffDashboard;