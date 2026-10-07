import React from "react";
import { useNavigate } from "@shared/next-router";
import Layout from "@shared/components/Layout";
import { useAuth } from "@app/providers/AuthProvider";
import { usePendingItemsContext } from "@app/providers/PendingItemsProvider";
import { usePendingServicesContext } from "@app/providers/PendingServicesProvider";
import { useDeliveredItemsContext } from "@app/providers/DeliveredItemsProvider";
import { useOutedItemsContext } from "@app/providers/OutedItemsProvider";
import { useMyRequestsProcessingCount } from "../hooks/useMyRequestsProcessingCount";
import { useDashboardSummary } from "../hooks/useDashboardSummary";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import styles from "./MainDashboard.module.css";

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
  const myRequestsProcessingCount = useMyRequestsProcessingCount(user?.role, user?.name, user?.department, startDate, endDate);
  const { completeRequestsCount, heldItemsCount, itemListCount, deletedCount, totalRequestsCount, loading } = useDashboardSummary(user?.permissions.includes("deleted_items") ?? false);
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
    tiles.push({ key: "dept-requests", label: "Department Requests", icon: "📋", value: myRequestsProcessingCount, variant: "primary", path: "/dashboard/staff" });
  }
  if (canSeePendingRequests) {
    tiles.push({
      key: "pending-requests",
      label: "Pending Requests",
      icon: "📋",
      value: pendingRequestsCount,
      variant: "danger",
      path: isAdmin ? "/dashboard/admin/requests" : "/dashboard/custodian",
    });
  }
  if (showPendingSection) {
    tiles.push({ key: "complete-requests", label: "Complete Requests", icon: "✅", value: completeRequestsCount, variant: "success", path: "/dashboard/complete-requests" });
  }
  if (showPendingSection) {
    tiles.push({ key: "item-list", label: "Item List", icon: "📚", value: itemListCount, variant: "primary", path: "/dashboard/item-list" });
    tiles.push({ key: "pending-items", label: "Pending Purchase Items", icon: "⏳", value: pendingItemsCount, variant: "warning", path: "/dashboard/pending-items" });
    tiles.push({ key: "delivered-items", label: "Delivered Purchase Items", icon: "📦", value: deliveredItemsCount, variant: "success", path: "/dashboard/delivered-items" });
    tiles.push({ key: "pending-services", label: "Pending Services", icon: "🛠️", value: pendingServicesCount, variant: "warning", path: "/dashboard/pending-services" });
  }
  if (canSeeHeldItems) {
    tiles.push({ key: "held-items", label: "Held Items", icon: "⏸️", value: heldItemsCount, variant: "warning", path: "/dashboard/held-items" });
  }
  if (showPendingSection) {
    tiles.push({ key: "outed-items", label: "ISSUED LIST OF ITEM", icon: "📤", value: outedItemsCount, variant: "primary", path: "/dashboard/outed-items" });
    tiles.push({ key: "deleted", label: "Deleted", icon: "🗑️", value: deletedCount, variant: "danger", path: "/dashboard/deleted-items" });
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
