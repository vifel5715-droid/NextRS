import React from "react";
import { useNavigate } from "@/lib/next-router";
import Layout from "@/components/layout/Layout";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePendingItemsContext } from "@/components/providers/PendingItemsProvider";
import { usePendingServicesContext } from "@/components/providers/PendingServicesProvider";
import { useDeliveredItemsContext } from "@/components/providers/DeliveredItemsProvider";
import { useOutedItemsContext } from "@/components/providers/OutedItemsProvider";
import { useDashboardCounts } from "@/components/providers/DashboardCountsProvider";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import DateRangeFilter from "@/components/forms/DateRangeFilter";
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

const MainDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const isAdmin = role === "admin";

  const { startDate, endDate } = useDateRangeContext();
  const pendingItems = usePendingItemsContext();
  const pendingItemsCount = filterByDateRange(pendingItems, startDate, endDate, "created_at")
    .reduce((sum, req) => sum + req.items.length, 0);
  const pendingServices = usePendingServicesContext();
  const pendingServicesCount = filterByDateRange(pendingServices, startDate, endDate, "created_at").length;
  const deliveredItems = useDeliveredItemsContext();
  const deliveredItemsCount = filterByDateRange(deliveredItems, startDate, endDate, "created_at")
    .reduce((sum, req) => sum + req.items.length, 0);
  const outedItems = useOutedItemsContext();
  const outedItemsCount = outedItems.reduce(
    (sum, req) => sum + filterByDateRange(req.items, startDate, endDate, "issued_at").length,
    0
  );
  const {
    myRequestsProcessingCount,
    summary: { completeRequestsCount, heldItemsCount, itemListCount, deletedCount, totalRequestsCount, loading },
  } = useDashboardCounts();
  // Same total the Custodian/Admin "Pending Requests" page shows across its
  // Item + Service Requests tabs — not just requests still awaiting the
  // custodian (see Sidebar.tsx for the identical reasoning).
  const pendingRequestsCount = totalRequestsCount;

  const showPendingSection = ["staff", "secretary", "supervisor", "manager", "custodian", "admin", "director"].includes(role);
  const canSeeHeldItems = ["secretary", "supervisor", "manager", "custodian", "admin", "director"].includes(role);
  const canSeeDeptRequests = ["staff", "secretary", "supervisor", "manager", "admin"].includes(role);
  const canSeePendingRequests = ["custodian", "admin", "director"].includes(role);

  const tiles: Tile[] = [];
  if (canSeeDeptRequests) {
    tiles.push({ key: "dept-requests", label: "Department Requests", icon: "📋", value: myRequestsProcessingCount, variant: "primary", path: "/requests" });
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
    tiles.push({ key: "pending-items", label: "Pending Purchase Items", icon: "⏳", value: pendingItemsCount, variant: "warning", path: "/purchase-requests" });
    tiles.push({ key: "delivered-items", label: "Delivered Purchase Items", icon: "📦", value: deliveredItemsCount, variant: "success", path: "/purchase-requests/delivered" });
    tiles.push({ key: "pending-services", label: "Pending Services", icon: "🛠️", value: pendingServicesCount, variant: "warning", path: "/purchase-requests/services" });
  }
  if (canSeeHeldItems) {
    tiles.push({ key: "held-items", label: "Held Items", icon: "⏸️", value: heldItemsCount, variant: "warning", path: "/inventory/held" });
  }
  if (showPendingSection) {
    tiles.push({ key: "outed-items", label: "ISSUED LIST OF ITEM", icon: "📤", value: outedItemsCount, variant: "primary", path: "/inventory/issued" });
    tiles.push({ key: "deleted", label: "Deleted", icon: "🗑️", value: deletedCount, variant: "danger", path: "/reports/deleted" });
  }

  const totalTracked = tiles.reduce((sum, tile) => sum + tile.value, 0);

  return (
    <Layout>
      <div className="dash-container">
        <div className="dash-header">
          <h1 className="dash-title">DASHBOARD</h1>
        </div>

        <div className="mb-4">
          <DateRangeFilter />
        </div>

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
