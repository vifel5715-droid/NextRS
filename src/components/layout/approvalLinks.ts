/**
 * "Approval Requests" — one link per approval stage this user can act on.
 * Requesters who can't approve anything get a read-only view of their own
 * requests still in the chain. Once the Custodian approves, a request drops
 * off all of these and shows on the Pending Requests page instead.
 *
 * Shared by the Sidebar and the Dashboard's All Requests Summary so the
 * Approval Requests count and destination are the same in both places.
 */
export interface ApprovalRequestLink {
  path: string;
  label: string;
  count: number;
}

export function getApprovalRequestLinks(
  permissions: string[],
  counts: { awaitingSupervisorApprovalCount: number; awaitingCustodianApprovalCount: number }
): ApprovalRequestLink[] {
  const canApproveSupervisorStage = permissions.includes("supervisor_dashboard");
  const canApproveCustodianStage = permissions.includes("department_requests");
  const approvesBothStages = canApproveSupervisorStage && canApproveCustodianStage;
  const links: ApprovalRequestLink[] = [];
  if (canApproveSupervisorStage) {
    links.push({
      path: "/approvals",
      label: approvesBothStages ? "Approval Requests (Supervisor/Manager)" : "Approval Requests",
      count: counts.awaitingSupervisorApprovalCount,
    });
  }
  if (canApproveCustodianStage) {
    links.push({
      path: "/approvals/review",
      label: approvesBothStages ? "Approval Requests (Custodian)" : "Approval Requests",
      count: counts.awaitingCustodianApprovalCount,
    });
  }
  if (!canApproveSupervisorStage && !canApproveCustodianStage && permissions.includes("create_request")) {
    links.push({
      path: "/requests/approval",
      label: "Approval Requests",
      count: counts.awaitingSupervisorApprovalCount + counts.awaitingCustodianApprovalCount,
    });
  }
  return links;
}
