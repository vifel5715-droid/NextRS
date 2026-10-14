import React from "react";
import { useNavigate } from "@/lib/next-router";
import Layout from "@/components/layout/Layout";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDashboardCounts } from "@/components/providers/DashboardCountsProvider";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
import { getApprovalRequestLinks } from "@/components/layout/approvalLinks";
import { useSpecialRequestCounts } from "@/features/dashboard/hooks/useSpecialRequestCounts";
import styles from "@/features/dashboard/components/MainDashboard.module.css";

type Variant = "primary" | "success" | "warning" | "danger";

interface Tile {
  key: string;
  label: string;
  icon: string;
  value: number;
  variant: Variant;
  path: string;
}

interface SummaryCard {
  key: string;
  label: string;
  hint: string;
  icon: string;
  value: number;
  variant: Variant;
  /** Omitted when there's no single list showing exactly this count. */
  path?: string;
}

const MainDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isAdmin = role === "admin";

  const {
    myRequestsProcessingCount,
    summary: {
      completeRequestsCount,
      itemListCount,
      deletedCount,
      totalRequestsCount,
      awaitingSupervisorApprovalCount,
      awaitingCustodianApprovalCount,
      allRequestsCount,
      loading,
    },
  } = useDashboardCounts();
  const special = useSpecialRequestCounts();
  // Same total the Custodian/Admin "Pending Requests" page shows across its
  // Item + Service Requests tabs — not just requests still awaiting the
  // custodian (see Sidebar.tsx for the identical reasoning).
  const pendingRequestsCount = totalRequestsCount;

  const showPendingSection = ["staff", "secretary", "supervisor", "manager", "custodian", "admin", "director"].includes(role);
  const canSeeDeptRequests = ["staff", "secretary", "supervisor", "manager", "admin"].includes(role);
  const canSeePendingRequests = ["custodian", "admin", "director"].includes(role);

  const tiles: Tile[] = [];
  if (canSeeDeptRequests) {
    tiles.push({ key: "dept-requests", label: "Department Requests", icon: "📋", value: myRequestsProcessingCount, variant: "primary", path: "/requests/pending" });
  }
  if (canSeePendingRequests) {
    tiles.push({
      key: "pending-requests",
      label: "Pending Requests",
      icon: "📋",
      value: pendingRequestsCount,
      variant: "danger",
      path: isAdmin ? "/approvals/all" : "/approvals/custodian",
    });
  }
  if (showPendingSection) {
    tiles.push({ key: "complete-requests", label: "Complete Requests", icon: "✅", value: completeRequestsCount, variant: "success", path: "/reports" });
  }
  if (showPendingSection) {
    tiles.push({ key: "item-list", label: "Item List", icon: "📚", value: itemListCount, variant: "primary", path: "/inventory" });
  }
  if (showPendingSection) {
    tiles.push({ key: "deleted", label: "Deleted", icon: "🗑️", value: deletedCount, variant: "danger", path: "/reports/deleted" });
  }

  const totalTracked = tiles.reduce((sum, tile) => sum + tile.value, 0);

  // ---- All Requests Summary ----
  // Every count comes from the server, scoped by the same role/department
  // rules as the list each card opens (see getDashboardRequestCountsAction
  // and getSpecialRequestCountsAction). Item, service, urgent and
  // reimbursement requests live in separate tables, so Total is a plain sum
  // with no request counted twice.
  const permissions = user?.permissions ?? [];
  const canCreateRequest = permissions.includes("create_request");
  const canManageDepartmentRequests = permissions.includes("department_requests");
  const showRequestsSummary =
    canCreateRequest || canManageDepartmentRequests || permissions.includes("supervisor_dashboard");
  const custodianPendingPath = isAdmin ? "/approvals/all" : "/approvals/custodian";
  const approvalLinks = getApprovalRequestLinks(permissions, {
    awaitingSupervisorApprovalCount,
    awaitingCustodianApprovalCount,
  });
  const summaryCards: SummaryCard[] = [
    {
      key: "total",
      label: "Total Requests",
      hint: "Every request you can see",
      icon: "🗂️",
      value: allRequestsCount + (special.urgentCount ?? 0) + (special.reimbursementCount ?? 0),
      variant: "primary",
    },
    {
      key: "pending",
      label: "Pending Requests",
      hint: "Item & service, approved and in progress",
      icon: "📄",
      value: totalRequestsCount,
      variant: "warning",
      path: canManageDepartmentRequests ? custodianPendingPath : canCreateRequest ? "/requests/pending" : undefined,
    },
    {
      key: "approval",
      label: "Approval Requests",
      hint: "Item & service, awaiting approval",
      icon: "📋",
      value: approvalLinks.reduce((sum, link) => sum + link.count, 0),
      variant: "danger",
      path: approvalLinks[0]?.path,
    },
    {
      key: "completed",
      label: "Completed Requests",
      hint: "Item & service, fully served or finished",
      icon: "✅",
      value: completeRequestsCount,
      variant: "success",
      path: permissions.includes("complete_requests") ? "/reports" : undefined,
    },
  ];
  if (special.urgentCount !== null) {
    summaryCards.push({
      key: "urgent",
      label: "Urgent Requests",
      hint: "All urgent requests",
      icon: "🚨",
      value: special.urgentCount,
      variant: "danger",
      path: canCreateRequest
        ? "/requests/pending?tab=urgent"
        : canManageDepartmentRequests
          ? `${custodianPendingPath}?tab=urgent`
          : undefined,
    });
  }
  if (special.reimbursementCount !== null) {
    summaryCards.push({
      key: "reimbursement",
      label: "Reimbursement Requests",
      hint: "All reimbursement requests",
      icon: "🧾",
      value: special.reimbursementCount,
      variant: "primary",
      path: canCreateRequest ? "/requests/pending?tab=reimbursement" : undefined,
    });
  }
  const summaryLoading = loading || special.loading;

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <h1 className="dash-title">DASHBOARD</h1>
        </div>

        <div className="mb-4">
          <DateRangeFilter />
        </div>

        {showRequestsSummary && (
          <section className={styles.summarySection} aria-labelledby="all-requests-summary">
            <h2 id="all-requests-summary" className={styles.reportTitle}>All Requests Summary</h2>
            {special.error && (
              <p className={styles.summaryError}>Some counts couldn&apos;t be loaded. They&apos;ll refresh automatically.</p>
            )}
            <div className={styles.grid}>
              {summaryCards.map((card) => {
                const content = (
                  <>
                    <span className={`stat-icon ${card.variant}`}>{card.icon}</span>
                    <span className="stat-content">
                      <span className="stat-value">{summaryLoading ? "…" : card.value}</span>
                      <span className="stat-label">{card.label}</span>
                      <span className={styles.summaryHint}>{card.hint}</span>
                    </span>
                  </>
                );
                return card.path ? (
                  <button
                    key={card.key}
                    type="button"
                    className={`stat-card ${styles.tile}`}
                    onClick={() => navigate(card.path!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={card.key} className={`stat-card ${styles.tile} ${styles.tileStatic}`}>
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className={styles.grid}>
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={`stat-card ${styles.tile}`}
              onClick={() => navigate(tile.path)}
            >
              <span className={`stat-icon ${tile.variant}`}>{tile.icon}</span>
              <span className="stat-content">
                <span className="stat-value">{loading ? "…" : tile.value}</span>
                <span className="stat-label">{tile.label}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.report}>
          <h2 className={styles.reportTitle}>Report Summary</h2>
          <div className={styles.reportTableWrap}>
            <table className={styles.reportTable}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {tiles.map((tile) => (
                  <tr key={tile.key}>
                    <td>{tile.icon} {tile.label}</td>
                    <td>{tile.value}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{totalTracked}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default MainDashboardPage;
