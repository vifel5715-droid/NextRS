import React from "react";
import { getBsStatusBadgeClass, formatStatusLabel } from "@shared/utils/status";
import { sanitizeUserInput } from "@shared/utils/sanitize";

const formatIsoDateOnly = (value?: string | null): string =>
  value ? new Date(value).toISOString().split("T")[0] : "—";

interface ApprovalTierProps {
  status?: string | null;
  approvedByName?: string | null;
  approvedByRole?: string | null;
  approvedAt?: string | null;
}

const ApprovalTier: React.FC<ApprovalTierProps> = ({ status, approvedByName, approvedByRole, approvedAt }) => (
  <div className="row g-2">
    <div className="col-12 col-sm-4">
      <div className="text-muted" style={{ fontSize: "0.72rem" }}>Status</div>
      {status ? (
        <span className={`badge ${getBsStatusBadgeClass(status)}`}>{formatStatusLabel(status)}</span>
      ) : (
        <span className="text-muted">—</span>
      )}
    </div>
    <div className="col-12 col-sm-4">
      <div className="text-muted" style={{ fontSize: "0.72rem" }}>Approved By</div>
      <div>{approvedByName || "—"}</div>
      {approvedByRole && (
        <div className="text-muted" style={{ fontSize: "0.72rem" }}>{formatStatusLabel(approvedByRole)}</div>
      )}
    </div>
    <div className="col-12 col-sm-4">
      <div className="text-muted" style={{ fontSize: "0.72rem" }}>Approved Date</div>
      <div>{formatIsoDateOnly(approvedAt)}</div>
    </div>
  </div>
);

export interface ApprovalStatusPanelProps {
  /** Defaults to "Supervisor" — pass "Supervisor And Manager" to match the
   * two call sites (StaffDashboard/CompleteRequestsPage item tabs) that show
   * that wording instead. Preserved as a prop rather than picking one during
   * this refactor, since the difference predates it and may be intentional. */
  supervisorLabel?: string;
  supervisorStatus?: string | null;
  supervisorApprovedByName?: string | null;
  supervisorApprovedByRole?: string | null;
  supervisorApprovedAt?: string | null;
  /** Defaults to "Custodian" — pass "Stockroom" for the Urgent Request
   * workflow's second tier (Stockroom is the existing Custodian role
   * wearing a different hat for that review step). */
  custodianLabel?: string;
  custodianStatus?: string | null;
  custodianApprovedByName?: string | null;
  custodianApprovedByRole?: string | null;
  custodianApprovedAt?: string | null;
  /** Optional third tier — e.g. "AP Officer" for the Reimbursement Request
   * workflow's three-stage chain. Omit entirely for the standard two-tier
   * chains (Supervisor + Custodian/Stockroom); when `thirdLabel` is given,
   * renders a third block below the second tier's. */
  thirdLabel?: string;
  thirdStatus?: string | null;
  thirdApprovedByName?: string | null;
  thirdApprovedByRole?: string | null;
  thirdApprovedAt?: string | null;
  rejectionComment?: string | null;
}

/**
 * The read-only "who approved this, and when" breakdown — Supervisor tier
 * then Custodian tier, each with Status/Approved By/Approved Date, plus an
 * optional Declined Comment. Shown for every role (including admin, whose
 * own Action boxes elsewhere only offer controls like Reset, not this
 * history) on CustodianDashboard, StaffDashboard, and CompleteRequestsPage
 * for both item and service requests — was copy-pasted six times with minor
 * drift (see ApprovalStatusPanelProps.supervisorLabel) before this extraction.
 * SupervisorDashboard's own "Approval" panel is a genuinely different,
 * simpler design (single status + inline action button) and isn't built
 * from this component.
 */
const ApprovalStatusPanel: React.FC<ApprovalStatusPanelProps> = ({
  supervisorLabel = "Supervisor",
  supervisorStatus,
  supervisorApprovedByName,
  supervisorApprovedByRole,
  supervisorApprovedAt,
  custodianLabel = "Custodian",
  custodianStatus,
  custodianApprovedByName,
  custodianApprovedByRole,
  custodianApprovedAt,
  thirdLabel,
  thirdStatus,
  thirdApprovedByName,
  thirdApprovedByRole,
  thirdApprovedAt,
  rejectionComment,
}) => (
  <div className="border rounded p-3 mb-3">
    <div className="fw-semibold text-secondary small text-uppercase mb-3">Approval Status</div>

    <div className="mb-3 pb-3 border-bottom">
      <div className="text-muted fw-semibold small mb-2">{supervisorLabel}</div>
      <ApprovalTier
        status={supervisorStatus}
        approvedByName={supervisorApprovedByName}
        approvedByRole={supervisorApprovedByRole}
        approvedAt={supervisorApprovedAt}
      />
    </div>

    <div className={thirdLabel ? "mb-3 pb-3 border-bottom" : ""}>
      <div className="text-muted fw-semibold small mb-2">{custodianLabel}</div>
      <ApprovalTier
        status={custodianStatus}
        approvedByName={custodianApprovedByName}
        approvedByRole={custodianApprovedByRole}
        approvedAt={custodianApprovedAt}
      />
    </div>

    {thirdLabel && (
      <div>
        <div className="text-muted fw-semibold small mb-2">{thirdLabel}</div>
        <ApprovalTier
          status={thirdStatus}
          approvedByName={thirdApprovedByName}
          approvedByRole={thirdApprovedByRole}
          approvedAt={thirdApprovedAt}
        />
      </div>
    )}

    {rejectionComment && (
      <div className="mt-3 pt-3 border-top">
        <div className="text-muted" style={{ fontSize: "0.72rem" }}>Declined Comment</div>
        <div className="text-danger fw-medium">{sanitizeUserInput(rejectionComment)}</div>
      </div>
    )}
  </div>
);

export default ApprovalStatusPanel;
