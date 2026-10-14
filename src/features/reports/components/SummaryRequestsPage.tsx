import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/layout/Layout";
import ListToolbar from "@/components/tables/ListToolbar";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { getRequestListsAction } from "@/features/requests/actions/request-lists";
import { getVisibleSpecialRequestsAction } from "@/features/requests/actions/special-requests";
import { urgentStatus, reimbursementStatus } from "@/features/requests/utils/specialRequestStatus";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { getCompositeStatus, getStatusBadgeClass, isFullyApproved } from "@/lib/utils/status";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { debounce } from "@/lib/utils/debounce";
import { exportToExcel } from "@/lib/utils/exportExcel";
import { formatMilitaryDateTime } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { createLogger } from "@/lib/client-logger";
import { sanitizeUserInput } from "@/lib/utils/sanitize";
import { getItemBalance } from "@/lib/utils/itemBalance";
import ApprovalStatusPanel from "@/features/requests/components/ApprovalStatusPanel";
import ItemStatusBadge from "@/features/requests/components/ItemStatusBadge";
import type { ItemRequest, ReimbursementRequest, ServiceRequest, UrgentRequest } from "@/types";

const log = createLogger("SummaryRequestsPage");

type RequestKind = "item" | "service" | "urgent" | "reimbursement";
/** Where a request sits in its lifecycle — the Stage filter. */
type Stage = "approval" | "pending" | "completed" | "declined";

const kindLabels: Record<RequestKind, string> = {
  item: "Item",
  service: "Service",
  urgent: "Urgent",
  reimbursement: "Reimbursement",
};
const stageLabels: Record<Stage, string> = {
  approval: "Awaiting Approval",
  pending: "Pending",
  completed: "Completed",
  declined: "Declined",
};

interface SummaryRow {
  kind: RequestKind;
  id: number;
  serial: string;
  createdAt: string;
  requestedBy: string;
  department: string;
  purpose: string;
  stage: Stage;
  statusText: string;
  statusBadgeClass: string;
  /** The full request, for the expandable details row. */
  source:
    | { kind: "item"; request: ItemRequest }
    | { kind: "service"; request: ServiceRequest }
    | { kind: "urgent"; request: UrgentRequest }
    | { kind: "reimbursement"; request: ReimbursementRequest };
}

// Same terminal states the Completed Requests page and the dashboard counts
// use: an item request with every line served, a service request whose PR
// is finished.
const fromStandard = (kind: "item" | "service", row: ItemRequest | ServiceRequest): SummaryRow => {
  const finished = kind === "item" ? !!row.all_items_served : (row as ServiceRequest).pr_status === "finish";
  const composite = getCompositeStatus(row as unknown as Record<string, unknown>);
  const stage: Stage =
    composite.class === "rejected" ? "declined" : finished ? "completed" : isFullyApproved(row) ? "pending" : "approval";
  return {
    kind,
    id: row.id,
    serial: row.serial || "",
    createdAt: (row.created_at as string) || "",
    requestedBy: row.requested_by || row.created_by || "",
    department: row.department || "",
    purpose: row.purpose || "",
    stage,
    statusText: kind === "service" && finished ? "Service Finished" : composite.text,
    statusBadgeClass: getStatusBadgeClass(finished ? "approved" : composite.class),
    source: kind === "item" ? { kind, request: row as ItemRequest } : { kind, request: row as ServiceRequest },
  };
};

const fromUrgent = (row: UrgentRequest): SummaryRow => {
  const status = urgentStatus(row);
  // No completed state of its own — once Stockroom has signed off (or isn't
  // needed) it's simply being fulfilled.
  const stage: Stage =
    row.supervisor_status === "rejected" || row.stockroom_status === "rejected"
      ? "declined"
      : row.stockroom_status === "approved" || row.stockroom_status === "not_required"
        ? "pending"
        : "approval";
  return {
    kind: "urgent",
    id: row.id,
    serial: row.serial,
    createdAt: row.created_at,
    requestedBy: row.requested_by || row.created_by,
    department: row.department,
    purpose: row.purpose,
    stage,
    statusText: status.text,
    statusBadgeClass: status.badgeClass,
    source: { kind: "urgent", request: row },
  };
};

const fromReimbursement = (row: ReimbursementRequest): SummaryRow => {
  const status = reimbursementStatus(row);
  const stage: Stage =
    row.supervisor_status === "rejected" || row.purchaser_status === "rejected" || row.ap_status === "rejected"
      ? "declined"
      : row.ap_status === "closed"
        ? "completed"
        : row.ap_status === "approved"
          ? "pending"
          : "approval";
  return {
    kind: "reimbursement",
    id: row.id,
    serial: row.serial,
    createdAt: row.created_at,
    requestedBy: row.requested_by || row.created_by,
    department: row.department,
    purpose: row.purpose,
    stage,
    statusText: status.text,
    statusBadgeClass: status.badgeClass,
    source: { kind: "reimbursement", request: row },
  };
};

const peso = (value: string | number | null | undefined) =>
  value == null || value === "" ? "—" : `₱${Number(value).toFixed(2)}`;
const dash = (value: React.ReactNode) => (value === undefined || value === null || value === "" ? "—" : value);
const shortDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "");

/** Header facts shown above a request's lines table. */
const Facts: React.FC<{ facts: Array<[string, React.ReactNode]> }> = ({ facts }) => (
  <div className="row g-3 mb-3">
    {facts.map(([label, value]) => (
      <div key={label} className="col-6 col-md-3">
        <div className="text-muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>{label}</div>
        <div style={{ whiteSpace: "pre-wrap" }}>{dash(value)}</div>
      </div>
    ))}
  </div>
);

/** Read-only details of one request — what its own page shows, minus the actions. */
const RequestDetails: React.FC<{ source: SummaryRow["source"] }> = ({ source }) => {
  if (source.kind === "item") {
    const r = source.request;
    return (
      <>
        <Facts
          facts={[
            ["Requested By", r.requested_by],
            ["Created By", r.created_by],
            ["Remarks", r.remarks ? sanitizeUserInput(r.remarks) : ""],
            ["PR Numbers", r.pr_numbers],
          ]}
        />
        <div className="table-responsive mb-3">
          <table className="table table-sm table-bordered mb-0">
            <thead className="table-light">
              <tr>
                <th>Item Name</th>
                <th>Qty</th>
                <th>UoM</th>
                <th>Remarks</th>
                <th>Machine Code</th>
                <th>Balance</th>
                <th>PR Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(r.items ?? []).length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted">No items.</td></tr>
              ) : (
                (r.items ?? []).map((item, idx) => (
                  <tr key={item.id ?? idx}>
                    <td>{item.item_name}</td>
                    <td>{item.quantity}</td>
                    <td>{item.uom}</td>
                    <td>{dash(item.remarks)}</td>
                    <td>{dash(item.machine_code)}</td>
                    <td>{getItemBalance(item)}</td>
                    <td>{dash(item.pr_number)}</td>
                    <td><ItemStatusBadge item={item} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ApprovalStatusPanel
          supervisorLabel="Supervisor And Manager"
          supervisorStatus={r.supervisor_status}
          supervisorApprovedByName={r.supervisor_approved_by_name}
          supervisorApprovedByRole={r.supervisor_approved_by_role}
          supervisorApprovedAt={r.supervisor_approved_at}
          custodianStatus={r.custodian_status}
          custodianApprovedByName={r.custodian_approved_by_name}
          custodianApprovedByRole={r.custodian_approved_by_role}
          custodianApprovedAt={r.custodian_approved_at}
          rejectionComment={r.rejection_comment}
        />
      </>
    );
  }

  if (source.kind === "service") {
    const r = source.request;
    return (
      <>
        <Facts
          facts={[
            ["Requested By", r.requested_by],
            ["Created By", r.created_by],
            ["Remarks", r.remarks ? sanitizeUserInput(r.remarks) : ""],
            ["PR Number / Status", [r.pr_number, r.pr_status].filter(Boolean).join(" · ")],
          ]}
        />
        <div className="table-responsive mb-3">
          <table className="table table-sm table-bordered mb-0">
            <thead className="table-light">
              <tr>
                <th>Description</th>
                <th>Delivery Status</th>
                <th>PR Number</th>
                <th>PR Status</th>
                <th>Receiving Report No.</th>
              </tr>
            </thead>
            <tbody>
              {(r.services ?? []).length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted">No services.</td></tr>
              ) : (
                (r.services ?? []).map((service, idx) => (
                  <tr key={service.id ?? idx}>
                    <td>{service.description}</td>
                    <td className="text-uppercase">{dash(service.delivery_status)}</td>
                    <td>{dash(service.pr_number)}</td>
                    <td className="text-uppercase">{dash(service.pr_status)}</td>
                    <td>{dash(service.receiving_report_no)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ApprovalStatusPanel
          supervisorLabel="Supervisor And Manager"
          supervisorStatus={r.supervisor_status}
          supervisorApprovedByName={r.supervisor_approved_by_name}
          supervisorApprovedByRole={r.supervisor_approved_by_role}
          supervisorApprovedAt={r.supervisor_approved_at}
          custodianStatus={r.custodian_status}
          custodianApprovedByName={r.custodian_approved_by_name}
          custodianApprovedByRole={r.custodian_approved_by_role}
          custodianApprovedAt={r.custodian_approved_at}
          rejectionComment={r.rejection_comment}
        />
      </>
    );
  }

  if (source.kind === "urgent") {
    const r = source.request;
    return (
      <>
        <Facts
          facts={[
            ["Requested By", r.requested_by],
            ["Created By", r.created_by],
            ["Date Needed", shortDate(r.date_needed)],
            ["Remarks", r.remarks ? sanitizeUserInput(r.remarks) : ""],
          ]}
        />
        <div className="table-responsive mb-3">
          <table className="table table-sm table-bordered mb-0">
            <thead className="table-light">
              <tr>
                <th>Item Description</th>
                <th>Qty</th>
                <th>UoM</th>
                <th>Inventoriable</th>
                <th>Purchasing</th>
                <th>Amount</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {r.items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted">No items.</td></tr>
              ) : (
                r.items.map((item, idx) => (
                  <tr key={item.id ?? idx}>
                    <td>{item.item_description}</td>
                    <td>{dash(item.quantity)}</td>
                    <td>{dash(item.uom)}</td>
                    <td>{item.is_inventoriable ? "Yes" : "No"}</td>
                    <td>
                      {item.purchasing_transaction === "purchase_order"
                        ? "Purchase Order"
                        : item.purchasing_transaction === "payment_request"
                          ? "Payment Request"
                          : "—"}
                    </td>
                    <td>{peso(item.amount)}</td>
                    <td className="text-capitalize">{(item.delivery_status ?? "pending").replace("_", " ")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ApprovalStatusPanel
          supervisorLabel="Supervisor And Manager"
          supervisorStatus={r.supervisor_status}
          supervisorApprovedByName={r.supervisor_approved_by_name}
          supervisorApprovedByRole={r.supervisor_approved_by_role}
          supervisorApprovedAt={r.supervisor_approved_at}
          custodianLabel="Stockroom"
          custodianStatus={r.stockroom_status}
          custodianApprovedByName={r.stockroom_approved_by_name}
          custodianApprovedAt={r.stockroom_approved_at}
          rejectionComment={r.rejection_comment}
        />
      </>
    );
  }

  const r = source.request;
  return (
    <>
      <Facts
        facts={[
          ["Requested By", r.requested_by],
          ["Supplier", r.supplier],
          ["Date Needed", shortDate(r.date_needed)],
          ["Remarks", r.remarks ? sanitizeUserInput(r.remarks) : ""],
        ]}
      />
      <div className="table-responsive mb-3">
        <table className="table table-sm table-bordered mb-0">
          <thead className="table-light">
            <tr>
              <th>Item Description</th>
              <th>Qty</th>
              <th>UoM</th>
              <th className="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item, idx) => (
              <tr key={item.id ?? idx}>
                <td>{item.item_description}</td>
                <td>{dash(item.quantity)}</td>
                <td>{dash(item.uom)}</td>
                <td className="text-end">{peso(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="text-end fw-bold">Total Cost:</td>
              <td className="text-end fw-bold">{peso(r.total_cost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ApprovalStatusPanel
        supervisorLabel="Supervisor And Manager"
        supervisorStatus={r.supervisor_status}
        supervisorApprovedByName={r.supervisor_approved_by_name}
        supervisorApprovedByRole={r.supervisor_approved_by_role}
        supervisorApprovedAt={r.supervisor_approved_at}
        custodianLabel="Purchaser"
        custodianStatus={r.purchaser_status}
        custodianApprovedByName={r.purchaser_approved_by_name}
        custodianApprovedAt={r.purchaser_approved_at}
        thirdLabel="AP Officer"
        thirdStatus={r.ap_status}
        thirdApprovedByName={r.ap_approved_by_name}
        thirdApprovedAt={r.ap_approved_at}
        rejectionComment={r.rejection_comment}
      />
    </>
  );
};

/**
 * Summary Requests — every request the user can see, of every type and in
 * every state, in one list. Read-only: each request is still worked on from
 * its own page. Item/service rows come from the same action as Completed
 * Requests, urgent/reimbursement rows from the same actions as their tabs,
 * so the server applies the usual role/department scoping.
 */
const SummaryRequestsPage: React.FC = () => {
  const { startDate, endDate } = useDateRangeContext();
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<RequestKind | "all">("all");
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Rows whose details are dropped down, keyed "<kind>-<id>".
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const loadRows = useCallback(async () => {
    try {
      const [{ itemRequests, serviceRequests }, { urgent, reimbursement }] = await Promise.all([
        getRequestListsAction(),
        getVisibleSpecialRequestsAction(),
      ]);
      setRows(
        [
          ...itemRequests.map((row) => fromStandard("item", row)),
          ...serviceRequests.map((row) => fromStandard("service", row)),
          ...(urgent ?? []).map(fromUrgent),
          ...(reimbursement ?? []).map(fromReimbursement),
        ].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      );
      setError(null);
    } catch (err: unknown) {
      log.error("Failed to load requests:", err);
      setError(getErrorMessage(err, "Failed to load requests. Please try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Any request created/approved/declined/served anywhere refreshes the list.
  const debouncedLoad = useRef(debounce(loadRows, 400));
  const handleChange = useCallback(() => debouncedLoad.current(), []);
  useRequestsChanged(handleChange);

  const rowsInRange = useMemo(
    () => filterByDateRange(rows, startDate, endDate, "createdAt"),
    [rows, startDate, endDate]
  );
  const searchedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const byStage = stageFilter === "all" ? rowsInRange : rowsInRange.filter((row) => row.stage === stageFilter);
    if (!q) return byStage;
    return byStage.filter((row) =>
      [row.serial, row.requestedBy, row.department, row.purpose, row.statusText].some((field) =>
        field.toLowerCase().includes(q)
      )
    );
  }, [rowsInRange, stageFilter, searchQuery]);
  const visibleRows = useMemo(
    () => (kindFilter === "all" ? searchedRows : searchedRows.filter((row) => row.kind === kindFilter)),
    [searchedRows, kindFilter]
  );
  const countFor = (kind: RequestKind) => searchedRows.filter((row) => row.kind === kind).length;

  const handleExport = () =>
    exportToExcel(
      "summary-requests",
      [
        { key: "serial", label: "Serial" },
        { key: "date", label: "Date" },
        { key: "type", label: "Type" },
        { key: "requested_by", label: "Requested By" },
        { key: "department", label: "Department" },
        { key: "purpose", label: "Purpose" },
        { key: "stage", label: "Stage" },
        { key: "status", label: "Status" },
      ],
      visibleRows.map((row) => ({
        serial: row.serial,
        date: row.createdAt ? formatMilitaryDateTime(row.createdAt) : "",
        type: kindLabels[row.kind],
        requested_by: row.requestedBy,
        department: row.department,
        purpose: row.purpose,
        stage: stageLabels[row.stage],
        status: row.statusText,
      }))
    );

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Summary Requests</h1>
            <p className="dash-subtitle">Every request you can see — all types, every stage</p>
          </div>
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Serial, Requested By, Department, Purpose, Status..."
          onExport={handleExport}
          exportDisabled={visibleRows.length === 0}
        />

        <div className="dash-tabs mb-4">
          <button
            className={`dash-tab ${kindFilter === "all" ? "active" : ""}`}
            onClick={() => setKindFilter("all")}
          >
            All Requests
            <span className="dash-tab-badge">{searchedRows.length}</span>
          </button>
          {(Object.keys(kindLabels) as RequestKind[]).map((kind) => (
            <button
              key={kind}
              className={`dash-tab ${kindFilter === kind ? "active" : ""}`}
              onClick={() => setKindFilter(kind)}
            >
              {kindLabels[kind]} Requests
              <span className="dash-tab-badge">{countFor(kind)}</span>
            </button>
          ))}
        </div>

        <div className="d-flex flex-wrap align-items-end gap-3 mb-4">
          <DateRangeFilter />
          <div>
            <label className="form-label" htmlFor="summary-stage-filter">Stage</label>
            <select
              id="summary-stage-filter"
              className="form-select"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as Stage | "all")}
            >
              <option value="all">All Stages</option>
              {(Object.keys(stageLabels) as Stage[]).map((stage) => (
                <option key={stage} value={stage}>{stageLabels[stage]}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="alert alert-warning d-flex align-items-center gap-2">
            <span>{error}</span>
            <button className="btn btn-sm btn-outline-warning" onClick={() => void loadRows()}>
              Retry
            </button>
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-sm table-hover mb-0 simple-list-table">
            <thead className="table-light">
              <tr>
                <th style={{ width: "36px" }}></th>
                <th>Serial</th>
                <th>Date &amp; Time</th>
                <th>Type</th>
                <th>Requested By</th>
                <th>Department</th>
                <th>Purpose</th>
                <th>Stage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted py-3">Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-muted py-3">
                    {rows.length === 0 ? "No requests yet." : "No requests match your filters."}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const key = `${row.kind}-${row.id}`;
                  const isOpen = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                  <tr
                    onClick={() => toggleRow(key)}
                    style={{ cursor: "pointer" }}
                    aria-expanded={isOpen}
                    title={isOpen ? "Hide details" : "Show details"}
                  >
                    <td className="text-center text-muted">
                      <i className={`bi bi-chevron-${isOpen ? "down" : "right"}`}></i>
                    </td>
                    <td data-label="Serial" className="text-nowrap fw-semibold">{row.serial}</td>
                    <td data-label="Date & Time" className="text-muted text-nowrap">
                      {row.createdAt ? formatMilitaryDateTime(row.createdAt) : ""}
                    </td>
                    <td data-label="Type">{kindLabels[row.kind]}</td>
                    <td data-label="Requested By">{row.requestedBy}</td>
                    <td data-label="Department">{row.department}</td>
                    <td data-label="Purpose">{row.purpose}</td>
                    <td data-label="Stage" className="text-nowrap">{stageLabels[row.stage]}</td>
                    <td data-label="Status">
                      <span className={`badge ${row.statusBadgeClass}`}>{row.statusText}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} style={{ background: "#f8fafc", padding: "16px 20px" }}>
                        <RequestDetails source={row.source} />
                      </td>
                    </tr>
                  )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

export default SummaryRequestsPage;
