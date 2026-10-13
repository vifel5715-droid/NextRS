import React, { useEffect } from "react";
import { useNavigate, useLocation } from "@/lib/next-router";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePendingItemsContext } from "@/components/providers/PendingItemsProvider";
import { usePendingServicesContext } from "@/components/providers/PendingServicesProvider";
import { useDeliveredItemsContext } from "@/components/providers/DeliveredItemsProvider";
import { useOutedItemsContext } from "@/components/providers/OutedItemsProvider";
import { useDashboardCounts } from "@/components/providers/DashboardCountsProvider";
import { useDateRangeContext } from "@/components/providers/DateRangeProvider";
import { filterByDateRange } from "@/lib/utils/dateRange";
import { createLogger } from "@/lib/client-logger";

const log = createLogger("Sidebar");

/** Small numeric pill shared by every sidebar item's unread/pending count —
 * renders nothing at zero, same as the badges that already existed inline
 * for Pending Items/Delivered Items/Pending Services/Outed Items. */
const CountBadge: React.FC<{ count: number; color: string }> = ({ count, color }) =>
  count > 0 ? (
    <span style={{
      background: color,
      color: "#fff",
      borderRadius: "10px",
      padding: "1px 7px",
      fontSize: "0.72rem",
      fontWeight: 700,
      marginLeft: "4px",
    }}>
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDesktop?: boolean;
}

const menuIcons: Record<string, string> = {
  "/requests": "📋",
  "/approvals/purchaser": "🛒",
  "/approvals/custodian": "📋",
  "/approvals/all": "📋",
  "/settings": "⚙️",
  "/reports/deleted": "🗑️",
  "/inventory/held": "⏸️",
  "/inventory": "📚",
  "/inventory/new-items": "🆕",
  "/purchase-requests/payment-requests": "📨",
};

const Sidebar: React.FC<SidebarProps> = ({ onClose, isDesktop = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const hasPermission = (key: string) => user?.permissions.includes(key) ?? false;
  const { startDate, endDate } = useDateRangeContext();
  const pendingItems = usePendingItemsContext();
  const pendingItemsCount = filterByDateRange(pendingItems, startDate, endDate, "created_at")
    .reduce((sum, req) => sum + req.items.length, 0);
  const pendingServices = usePendingServicesContext();
  const pendingServicesFiltered = filterByDateRange(pendingServices, startDate, endDate, "created_at");
  const deliveredItems = useDeliveredItemsContext();
  const deliveredItemsCount = filterByDateRange(deliveredItems, startDate, endDate, "created_at")
    .reduce((sum, req) => sum + req.items.length, 0);
  const outedItems = useOutedItemsContext();
  // Outed items carry their own per-item release date (issued_at), unlike
  // Pending/Delivered which only have a date at the parent-request level —
  // so this one filters each request's items individually rather than the
  // whole request.
  const outedItemsCount = outedItems.reduce(
    (sum, req) => sum + filterByDateRange(req.items, startDate, endDate, "issued_at").length,
    0
  );
  const {
    myRequestsProcessingCount,
    summary: { completeRequestsCount, heldItemsCount, itemListCount, deletedCount, totalRequestsCount },
    adjustmentLog: { entries: adjustmentEntries },
  } = useDashboardCounts();
  // Same total the Custodian/Admin "Pending Requests" page shows across its
  // Item + Service Requests tabs (CustodianDashboard.tsx) — not just requests
  // still awaiting the custodian, so this badge can never disagree with what
  // that page's own tab badges add up to.
  const pendingRequestsCount = totalRequestsCount;
  const adjustmentHistoryCount = adjustmentEntries.length;
  const isAdmin = user?.role?.toLowerCase().trim() === "admin";
  // Supervisor/Manager keep the supervisor_dashboard permission (server
  // actions rely on it for approvals) but don't get the sidebar link.
  const hideSupervisorDashboardLink = ["supervisor", "manager"].includes(user?.role?.toLowerCase().trim() ?? "");

  useEffect(() => {
    log.info("Mounted — user:", user?.email, `role: ${user?.role}`);
    return () => { log.info("Unmounted"); };
  }, [user?.email, user?.role]);

  const menuItems = [
    { path: isAdmin ? "/approvals/all" : "/approvals/custodian", label: "Pending Requests", permission: "department_requests" },
    { path: "/settings", label: "Users Management", permission: "users_management" },
  ];

  const filteredItems = menuItems.filter((item) => user?.permissions.includes(item.permission) ?? false);

  // Each sidebar row below is gated by its own page permission now, rather
  // than one shared boolean — a custom role can have any subset checked.
  const canCreateRequest = hasPermission("create_request");

  const handleItemClick = (path: string) => {
    log.info("Navigating to:", path);
    navigate(path);
    // Always closes the mobile drawer after a nav click — harmless on
    // desktop, where the sidebar's visibility is driven entirely by CSS
    // (see .sidebar's media query in globals.css) and doesn't depend on this
    // callback at all. Previously gated on `isDesktop`, but Layout.tsx always
    // passes isDesktop={true} regardless of actual screen size, so on a real
    // mobile device this never fired and the drawer stayed open over the
    // page after tapping a link.
    onClose();
  };


  const renderMenuItem = (item: (typeof menuItems)[number]) => (
    <li className="sidebar-item" key={item.path}>
      <button
        className={`sidebar-link ${location.pathname === item.path ? "active" : ""}`}
        onClick={() => {
          if (item.path === "/settings") {
            handleItemClick(`${item.path}?tab=users`);
          } else {
            handleItemClick(item.path);
          }
        }}
        style={{ position: "relative" }}
      >
        <span className="sidebar-icon">{menuIcons[item.path]}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {(item.path === "/approvals/custodian" || item.path === "/approvals/all") && (
          <CountBadge count={pendingRequestsCount} color="#d97706" />
        )}
      </button>
    </li>
  );

  const pendingRequestsItem = filteredItems.find((item) => item.path === "/approvals/custodian" || item.path === "/approvals/all");
  const usersManagementItem = filteredItems.find((item) => item.path === "/settings");
  const canSeeHeldItems = hasPermission("held_items");
  const itemsHubPaths = ["/inventory", "/inventory/held", "/inventory/issued"];

  const renderNavContent = () => (
    <>
      <div className="sidebar-header">
        <h6 className="sidebar-title">Menu</h6>
      </div>
      <nav className="sidebar-nav">
        <ul className="sidebar-menu">
          {hasPermission("overview") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/dashboard" ? "active" : ""}`}
                onClick={() => handleItemClick("/dashboard")}
              >
                <span className="sidebar-icon">🏠</span>
                <span style={{ flex: 1 }}>Dashboard</span>
              </button>
            </li>
          )}
          {canCreateRequest && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${
                  location.pathname === "/requests" && new URLSearchParams(location.search).get("tab") === "create"
                    ? "active"
                    : ""
                }`}
                onClick={() => handleItemClick("/requests?tab=create")}
              >
                <span className="sidebar-icon">➕</span>
                <span style={{ flex: 1 }}>Create New Request</span>
                <CountBadge count={myRequestsProcessingCount} color="#dc3545" />
              </button>
            </li>
          )}
          {pendingRequestsItem && renderMenuItem(pendingRequestsItem)}
          {hasPermission("supervisor_dashboard") && !hideSupervisorDashboardLink && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/approvals" ? "active" : ""}`}
                onClick={() => handleItemClick("/approvals")}
              >
                <span className="sidebar-icon">📊</span>
                <span style={{ flex: 1 }}>Supervisor Dashboard</span>
              </button>
            </li>
          )}
          {hasPermission("purchaser_dashboard") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/approvals/purchaser" ? "active" : ""}`}
                onClick={() => handleItemClick("/approvals/purchaser")}
              >
                <span className="sidebar-icon">🛒</span>
                <span style={{ flex: 1 }}>Purchaser Dashboard</span>
              </button>
            </li>
          )}
          {hasPermission("ap_officer_dashboard") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/approvals/ap-officer" ? "active" : ""}`}
                onClick={() => handleItemClick("/approvals/ap-officer")}
              >
                <span className="sidebar-icon">🧾</span>
                <span style={{ flex: 1 }}>Reimbursement Dashboard</span>
              </button>
            </li>
          )}
          {hasPermission("submitted_payment_requests") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/purchase-requests/payment-requests" ? "active" : ""}`}
                onClick={() => handleItemClick("/purchase-requests/payment-requests")}
              >
                <span className="sidebar-icon">📨</span>
                <span style={{ flex: 1 }}>Submitted Payment Request</span>
              </button>
            </li>
          )}
          {hasPermission("petty_cash") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/petty-cash" ? "active" : ""}`}
                onClick={() => handleItemClick("/petty-cash")}
              >
                <span className="sidebar-icon">💵</span>
                <span style={{ flex: 1 }}>Cash Purchase Base on P.O</span>
              </button>
            </li>
          )}
          {hasPermission("complete_requests") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/reports" ? "active" : ""}`}
                onClick={() => handleItemClick("/reports")}
              >
                <span className="sidebar-icon">✅</span>
                <span style={{ flex: 1 }}>Completed Requests</span>
                <CountBadge count={completeRequestsCount} color="#10b981" />
              </button>
            </li>
          )}
          {hasPermission("pending_items_services") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${
                  location.pathname === "/purchase-requests" || location.pathname === "/purchase-requests/services"
                    ? "active"
                    : ""
                }`}
                onClick={() => handleItemClick("/purchase-requests")}
              >
                <span className="sidebar-icon">⏳</span>
                <span style={{ flex: 1 }}>Pending Purchase Items &amp; Services</span>
                <CountBadge count={pendingItemsCount} color="#d97706" />
                <CountBadge count={pendingServicesFiltered.length} color="#7c3aed" />
              </button>
            </li>
          )}
          {hasPermission("delivered_items") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/purchase-requests/delivered" ? "active" : ""}`}
                onClick={() => handleItemClick("/purchase-requests/delivered")}
              >
                <span className="sidebar-icon">📦</span>
                <span style={{ flex: 1 }}>Delivered Purchase Items</span>
                <CountBadge count={deliveredItemsCount} color="#78350f" />
              </button>
            </li>
          )}
          {hasPermission("urgent_items") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/inventory/urgent-items" ? "active" : ""}`}
                onClick={() => handleItemClick("/inventory/urgent-items")}
              >
                <span className="sidebar-icon">🚨</span>
                <span style={{ flex: 1 }}>Urgent Item From IRS</span>
              </button>
            </li>
          )}
          {hasPermission("pending_item_entry") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/inventory/pending-entry" ? "active" : ""}`}
                onClick={() => handleItemClick("/inventory/pending-entry")}
              >
                <span className="sidebar-icon">📥</span>
                <span style={{ flex: 1 }}>Pending Item Entry</span>
              </button>
            </li>
          )}
          {hasPermission("new_item_list") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/inventory/new-items" ? "active" : ""}`}
                onClick={() => handleItemClick("/inventory/new-items")}
              >
                <span className="sidebar-icon">🆕</span>
                <span style={{ flex: 1 }}>New Item List</span>
              </button>
            </li>
          )}
          {hasPermission("item_list") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${itemsHubPaths.includes(location.pathname) ? "active" : ""}`}
                onClick={() => handleItemClick("/inventory")}
              >
                <span className="sidebar-icon">📚</span>
                <span style={{ flex: 1 }}>Item List</span>
                <CountBadge count={itemListCount} color="#2563eb" />
                {canSeeHeldItems && <CountBadge count={heldItemsCount} color="#0d9488" />}
                <CountBadge count={outedItemsCount} color="#0ea5e9" />
              </button>
            </li>
          )}
          {hasPermission("adjustment_history") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/reports/adjustments" ? "active" : ""}`}
                onClick={() => handleItemClick("/reports/adjustments")}
              >
                <span className="sidebar-icon">📝</span>
                <span style={{ flex: 1 }}>Adjustment History</span>
                <CountBadge count={adjustmentHistoryCount} color="#64748b" />
              </button>
            </li>
          )}
          {hasPermission("deleted_items") && (
            <li className="sidebar-item">
              <button
                className={`sidebar-link ${location.pathname === "/reports/deleted" ? "active" : ""}`}
                onClick={() => handleItemClick("/reports/deleted")}
              >
                <span className="sidebar-icon">🗑️</span>
                <span style={{ flex: 1 }}>Deleted</span>
                <CountBadge count={deletedCount} color="#991b1b" />
              </button>
            </li>
          )}
          {usersManagementItem && renderMenuItem(usersManagementItem)}
        </ul>
      </nav>
    </>
  );

  if (isDesktop) {
    return <>{renderNavContent()}</>;
  }

  return null;
};

export default Sidebar;
