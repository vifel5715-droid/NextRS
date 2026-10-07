"use client";

import React, { Suspense, lazy, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@app/providers/AuthProvider";
import { DateRangeProvider } from "@app/providers/DateRangeProvider";
import { DeliveredItemsProvider } from "@app/providers/DeliveredItemsProvider";
import { OutedItemsProvider } from "@app/providers/OutedItemsProvider";
import { PendingItemsProvider } from "@app/providers/PendingItemsProvider";
import { PendingServicesProvider } from "@app/providers/PendingServicesProvider";
import { useSocketConnection } from "@shared/hooks/useSocketConnection";
import LoadingScreen from "@shared/components/LoadingScreen";

type PageComponent = React.LazyExoticComponent<React.ComponentType>;

const LoginPage = lazy(() => import("@features/auth/pages/LoginPage"));
const UnauthorizedPage = lazy(() => import("@features/auth/pages/UnauthorizedPage"));
const StaffDashboard = lazy(() => import("@features/requests/pages/StaffDashboard"));
const SupervisorDashboard = lazy(() => import("@features/requests/pages/SupervisorDashboard"));
const PurchaserDashboard = lazy(() => import("@features/requests/pages/PurchaserDashboard"));
const APOfficerDashboard = lazy(() => import("@features/requests/pages/APOfficerDashboard"));
const PettyCashPage = lazy(() => import("@features/requests/pages/PettyCashPage"));
const CustodianDashboard = lazy(() => import("@features/requests/pages/CustodianDashboard"));
const AdminDashboard = lazy(() => import("@features/admin/pages/AdminDashboard"));
const PendingItemsPage = lazy(() => import("@features/requests/pages/PendingItemsPage"));
const DeliveredItemsPage = lazy(() => import("@features/items/pages/DeliveredItemsPage"));
const UrgentItemsPage = lazy(() => import("@features/requests/pages/UrgentItemsPage"));
const PendingItemEntryPage = lazy(() => import("@features/requests/pages/PendingItemEntryPage"));
const NewItemListPage = lazy(() => import("@features/requests/pages/NewItemListPage"));
const CompleteRequestsPage = lazy(() => import("@features/requests/pages/CompleteRequestsPage"));
const DeletedItemsPage = lazy(() => import("@features/items/pages/DeletedItemsPage"));
const ItemsHubPage = lazy(() => import("@features/items/pages/ItemsHubPage"));
const AdjustmentHistoryPage = lazy(() => import("@features/adjustments/pages/AdjustmentHistoryPage"));
const SubmittedPaymentRequestsPage = lazy(() => import("@features/requests/pages/SubmittedPaymentRequestsPage"));
const MainDashboardPage = lazy(() => import("@features/dashboard/pages/MainDashboardPage"));

const routes: Record<string, { component: PageComponent; permission?: string }> = {
  "/login": { component: LoginPage },
  "/unauthorized": { component: UnauthorizedPage },
  "/dashboard/staff": { component: StaffDashboard, permission: "create_request" },
  "/dashboard/supervisor": { component: SupervisorDashboard, permission: "supervisor_dashboard" },
  "/dashboard/purchaser": { component: PurchaserDashboard, permission: "purchaser_dashboard" },
  "/dashboard/ap-officer": { component: APOfficerDashboard, permission: "ap_officer_dashboard" },
  "/dashboard/petty-cash": { component: PettyCashPage, permission: "petty_cash" },
  "/dashboard/custodian": { component: CustodianDashboard, permission: "department_requests" },
  "/dashboard/admin": { component: AdminDashboard, permission: "users_management" },
  "/dashboard/admin/requests": { component: CustodianDashboard, permission: "department_requests" },
  "/request/new": { component: StaffDashboard, permission: "create_request" },
  "/dashboard/pending-items": { component: PendingItemsPage, permission: "pending_items_services" },
  "/dashboard/pending-services": { component: PendingItemsPage, permission: "pending_items_services" },
  "/dashboard/delivered-items": { component: DeliveredItemsPage, permission: "delivered_items" },
  "/dashboard/urgent-items": { component: UrgentItemsPage, permission: "urgent_items" },
  "/dashboard/pending-item-entry": { component: PendingItemEntryPage, permission: "pending_item_entry" },
  "/dashboard/new-item-list": { component: NewItemListPage, permission: "new_item_list" },
  "/dashboard/outed-items": { component: ItemsHubPage, permission: "item_list" },
  "/dashboard/complete-requests": { component: CompleteRequestsPage, permission: "complete_requests" },
  "/dashboard/deleted-items": { component: DeletedItemsPage, permission: "deleted_items" },
  "/dashboard/held-items": { component: ItemsHubPage, permission: "item_list" },
  "/dashboard/item-list": { component: ItemsHubPage, permission: "item_list" },
  "/dashboard/submitted-payment-requests": {
    component: SubmittedPaymentRequestsPage,
    permission: "submitted_payment_requests",
  },
  "/dashboard/adjustment-history": { component: AdjustmentHistoryPage, permission: "adjustment_history" },
  "/dashboard/overview": { component: MainDashboardPage, permission: "overview" },
};

function SocketBridge() {
  useSocketConnection();
  return null;
}

function RouteContent() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (pathname === "/") router.replace("/login");
  }, [pathname, router]);

  const route = routes[pathname];
  useEffect(() => {
    if (!route?.permission || loading) return;
    if (!user) router.replace("/login");
    else if (!user.permissions.includes(route.permission)) router.replace("/unauthorized");
  }, [loading, route, router, user]);

  if (pathname === "/") return <LoadingScreen />;
  if (!route) {
    return (
      <main className="not-found-page">
        <h1>Page not found</h1>
        <p>The page you requested does not exist.</p>
      </main>
    );
  }

  if (route.permission) {
    if (loading || !user || !user.permissions.includes(route.permission)) return <LoadingScreen />;
  }

  const Page = route.component;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Page />
    </Suspense>
  );
}

export default function ClientApp() {
  return (
    <AuthProvider>
      <SocketBridge />
      <DateRangeProvider>
        <PendingItemsProvider>
          <PendingServicesProvider>
            <DeliveredItemsProvider>
              <OutedItemsProvider>
                <RouteContent />
              </OutedItemsProvider>
            </DeliveredItemsProvider>
          </PendingServicesProvider>
        </PendingItemsProvider>
      </DateRangeProvider>
    </AuthProvider>
  );
}
