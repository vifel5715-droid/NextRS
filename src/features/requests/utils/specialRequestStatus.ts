import { getBsStatusBadgeClass } from "@/lib/utils/status";
import type { ReimbursementRequest, UrgentRequest } from "@/types";

/** Urgent/Reimbursement share one Supervisor/Manager stage — name it after whoever actually acted on it. */
export const supervisorStageLabel = (approverRole?: string) =>
  approverRole?.toLowerCase().trim() === "manager" ? "Manager" : "Supervisor";

/** Status badge of an urgent request — shared by every list that shows one. */
export const urgentStatus = (row: UrgentRequest) => ({
  badgeClass: getBsStatusBadgeClass(row.stockroom_status === "approved" ? "approved" : row.supervisor_status),
  text:
    row.supervisor_status === "rejected"
      ? `Declined (${supervisorStageLabel(row.supervisor_approved_by_role)})`
      : row.stockroom_status === "rejected"
      ? "Declined (Stockroom)"
      : row.stockroom_status === "approved"
      ? "Approved"
      : row.supervisor_status === "approved"
      ? `Approved (${supervisorStageLabel(row.supervisor_approved_by_role)})`
      : "Pending",
});

/** Status badge of a reimbursement request — shared by every list that shows one. */
export const reimbursementStatus = (row: ReimbursementRequest) => ({
  badgeClass: getBsStatusBadgeClass(
    row.ap_status === "closed"
      ? "closed"
      : row.ap_status === "approved"
      ? "approved"
      : row.purchaser_status === "approved"
      ? "approved"
      : row.supervisor_status
  ),
  text:
    row.supervisor_status === "rejected"
      ? `Declined (${supervisorStageLabel(row.supervisor_approved_by_role)})`
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
      ? `Approved (${supervisorStageLabel(row.supervisor_approved_by_role)})`
      : "Pending",
});
