"use client";

import React, { Activity, Fragment, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AuthProvider, useAuth } from "@app/providers/AuthProvider";
import { DateRangeProvider } from "@app/providers/DateRangeProvider";
import { DashboardCountsProvider } from "@app/providers/DashboardCountsProvider";
import { DeliveredItemsProvider } from "@app/providers/DeliveredItemsProvider";
import { OutedItemsProvider } from "@app/providers/OutedItemsProvider";
import { PendingItemsProvider } from "@app/providers/PendingItemsProvider";
import { PendingServicesProvider } from "@app/providers/PendingServicesProvider";
import LoadingScreen from "@shared/components/LoadingScreen";
import { ShellLayout } from "@shared/components/Layout";
import type { User } from "@shared/types";

type PageComponent = React.ComponentType;

// Literal dynamic(() => import(...)) calls so Next can still emit SSR chunk
// preloads; `preload` below repeats the same specifiers so idle-time warming
// can fetch a page's chunk before its first visit (the bundler dedupes them).
const LoginPage = dynamic(() => import("@features/auth/pages/LoginPage"));
const UnauthorizedPage = dynamic(() => import("@features/auth/pages/UnauthorizedPage"));
const StaffDashboard = dynamic(() => import("@features/requests/pages/StaffDashboard"));
const SupervisorDashboard = dynamic(() => import("@features/requests/pages/SupervisorDashboard"));
const PurchaserDashboard = dynamic(() => import("@features/requests/pages/PurchaserDashboard"));
const APOfficerDashboard = dynamic(() => import("@features/requests/pages/APOfficerDashboard"));
const PettyCashPage = dynamic(() => import("@features/requests/pages/PettyCashPage"));
const CustodianDashboard = dynamic(() => import("@features/requests/pages/CustodianDashboard"));
const AdminDashboard = dynamic(() => import("@features/admin/pages/AdminDashboard"));
const PendingItemsPage = dynamic(() => import("@features/requests/pages/PendingItemsPage"));
const DeliveredItemsPage = dynamic(() => import("@features/items/pages/DeliveredItemsPage"));
const UrgentItemsPage = dynamic(() => import("@features/requests/pages/UrgentItemsPage"));
const PendingItemEntryPage = dynamic(() => import("@features/requests/pages/PendingItemEntryPage"));
const NewItemListPage = dynamic(() => import("@features/requests/pages/NewItemListPage"));
const CompleteRequestsPage = dynamic(() => import("@features/requests/pages/CompleteRequestsPage"));
const DeletedItemsPage = dynamic(() => import("@features/items/pages/DeletedItemsPage"));
const ItemsHubPage = dynamic(() => import("@features/items/pages/ItemsHubPage"));
const AdjustmentHistoryPage = dynamic(() => import("@features/adjustments/pages/AdjustmentHistoryPage"));
const SubmittedPaymentRequestsPage = dynamic(() => import("@features/requests/pages/SubmittedPaymentRequestsPage"));
const MainDashboardPage = dynamic(() => import("@features/dashboard/pages/MainDashboardPage"));

const preload = {
  staff: () => import("@features/requests/pages/StaffDashboard"),
  supervisor: () => import("@features/requests/pages/SupervisorDashboard"),
  purchaser: () => import("@features/requests/pages/PurchaserDashboard"),
  apOfficer: () => import("@features/requests/pages/APOfficerDashboard"),
  pettyCash: () => import("@features/requests/pages/PettyCashPage"),
  custodian: () => import("@features/requests/pages/CustodianDashboard"),
  admin: () => import("@features/admin/pages/AdminDashboard"),
  pendingItems: () => import("@features/requests/pages/PendingItemsPage"),
  deliveredItems: () => import("@features/items/pages/DeliveredItemsPage"),
  urgentItems: () => import("@features/requests/pages/UrgentItemsPage"),
  pendingItemEntry: () => import("@features/requests/pages/PendingItemEntryPage"),
  newItemList: () => import("@features/requests/pages/NewItemListPage"),
  completeRequests: () => import("@features/requests/pages/CompleteRequestsPage"),
  deletedItems: () => import("@features/items/pages/DeletedItemsPage"),
  itemsHub: () => import("@features/items/pages/ItemsHubPage"),
  adjustmentHistory: () => import("@features/adjustments/pages/AdjustmentHistoryPage"),
  submittedPaymentRequests: () => import("@features/requests/pages/SubmittedPaymentRequestsPage"),
  overview: () => import("@features/dashboard/pages/MainDashboardPage"),
};

interface RouteDef {
  component: PageComponent;
  permission?: string;
  preload?: () => Promise<unknown>;
}

const routes: Record<string, RouteDef> = {
  "/login": { component: LoginPage },
  "/unauthorized": { component: UnauthorizedPage },
  "/dashboard/staff": { component: StaffDashboard, permission: "create_request", preload: preload.staff },
  "/dashboard/supervisor": { component: SupervisorDashboard, permission: "supervisor_dashboard", preload: preload.supervisor },
  "/dashboard/purchaser": { component: PurchaserDashboard, permission: "purchaser_dashboard", preload: preload.purchaser },
  "/dashboard/ap-officer": { component: APOfficerDashboard, permission: "ap_officer_dashboard", preload: preload.apOfficer },
  "/dashboard/petty-cash": { component: PettyCashPage, permission: "petty_cash", preload: preload.pettyCash },
  "/dashboard/custodian": { component: CustodianDashboard, permission: "department_requests", preload: preload.custodian },
  "/dashboard/admin": { component: AdminDashboard, permission: "users_management", preload: preload.admin },
  "/dashboard/admin/requests": { component: CustodianDashboard, permission: "department_requests", preload: preload.custodian },
  "/request/new": { component: StaffDashboard, permission: "create_request", preload: preload.staff },
  "/dashboard/pending-items": { component: PendingItemsPage, permission: "pending_items_services", preload: preload.pendingItems },
  "/dashboard/pending-services": { component: PendingItemsPage, permission: "pending_items_services", preload: preload.pendingItems },
  "/dashboard/delivered-items": { component: DeliveredItemsPage, permission: "delivered_items", preload: preload.deliveredItems },
  "/dashboard/urgent-items": { component: UrgentItemsPage, permission: "urgent_items", preload: preload.urgentItems },
  "/dashboard/pending-item-entry": { component: PendingItemEntryPage, permission: "pending_item_entry", preload: preload.pendingItemEntry },
  "/dashboard/new-item-list": { component: NewItemListPage, permission: "new_item_list", preload: preload.newItemList },
  "/dashboard/outed-items": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/dashboard/complete-requests": { component: CompleteRequestsPage, permission: "complete_requests", preload: preload.completeRequests },
  "/dashboard/deleted-items": { component: DeletedItemsPage, permission: "deleted_items", preload: preload.deletedItems },
  "/dashboard/held-items": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/dashboard/item-list": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/dashboard/submitted-payment-requests": {
    component: SubmittedPaymentRequestsPage,
    permission: "submitted_payment_requests",
    preload: preload.submittedPaymentRequests,
  },
  "/dashboard/adjustment-history": { component: AdjustmentHistoryPage, permission: "adjustment_history", preload: preload.adjustmentHistory },
  "/dashboard/overview": { component: MainDashboardPage, permission: "overview", preload: preload.overview },
};

/**
 * How many visited screens stay mounted (hidden) so returning to them is
 * instant. Bounded so a long session doesn't accumulate every page.
 */
const MAX_KEPT_PAGES = 6;

interface KeptPage {
  key: string;
  Page: PageComponent;
  permission?: string;
}

/**
 * Keeps recently visited screens mounted inside <Activity mode="hidden">.
 *
 * A hidden screen keeps its React state (fetched rows, tabs, filters,
 * expanded rows) but React tears down its effects — so its polling timers
 * and realtime subscriptions stop while it is off screen. When it is shown
 * again its effects re-run, which refetches in the background while the
 * previous rows stay visible, instead of remounting from empty state behind
 * a spinner.
 */
function KeptAlivePages({ active, permissions }: { active: KeptPage; permissions: string[] }) {
  const [pages, setPages] = useState<KeptPage[]>([active]);
  // Most recently used last. Adjusting state during render (rather than in
  // an effect) means the new screen mounts in the same commit.
  if (pages[pages.length - 1]?.key !== active.key) {
    setPages((prev) => [...prev.filter((p) => p.key !== active.key), active].slice(-MAX_KEPT_PAGES));
  }

  // Per-screen window scroll position, restored when a screen is revealed.
  const scrollPositions = useRef(new Map<string, number>());
  const activeKeyRef = useRef(active.key);
  useEffect(() => {
    const onScroll = () => scrollPositions.current.set(activeKeyRef.current, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (activeKeyRef.current === active.key) return;
    activeKeyRef.current = active.key;
    window.scrollTo(0, scrollPositions.current.get(active.key) ?? 0);
  }, [active.key]);

  return pages
    // A permission revoked mid-session (AuthProvider revalidates on focus)
    // drops that hidden screen rather than keeping it around.
    .filter((p) => !p.permission || permissions.includes(p.permission))
    .map(({ key, Page }) => (
      <Activity key={key} mode={key === active.key ? "visible" : "hidden"}>
        <Suspense fallback={<LoadingScreen fullScreen={false} />}>
          <Page />
        </Suspense>
      </Activity>
    ));
}

/**
 * Once the shell is idle, fetches the route payload and JS chunk for every
 * screen this user can open, so even a first sidebar click doesn't wait on
 * the network. Equivalent to what <Link> does for links in the viewport.
 */
function useWarmRoutes(permissions: string[]) {
  const router = useRouter();
  // By value: AuthProvider hands out a new array on every focus revalidation.
  const permissionKey = permissions.join(",");
  useEffect(() => {
    const allowed = new Set(permissionKey.split(","));
    const warm = () => {
      for (const [path, route] of Object.entries(routes)) {
        if (!route.permission || !allowed.has(route.permission)) continue;
        router.prefetch(path);
        route.preload?.().catch(() => {
          // A failed warm-up just means the chunk loads on first visit.
        });
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, [router, permissionKey]);
}

function AppShell({ route, routeKey, user }: { route: RouteDef; routeKey: string; user: User }) {
  useWarmRoutes(user.permissions);
  return (
    <DashboardCountsProvider>
      <ShellLayout>
        <KeptAlivePages
          active={{ key: routeKey, Page: route.component, permission: route.permission }}
          permissions={user.permissions}
        />
      </ShellLayout>
    </DashboardCountsProvider>
  );
}

function RouteContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // Everything a logged-in user sees (except the login form) lives in one
  // persistent shell, so the Navbar/Sidebar and visited screens survive
  // navigation.
  if (user && pathname !== "/login") {
    const search = searchParams.toString();
    return <AppShell route={route} routeKey={search ? `${pathname}?${search}` : pathname} user={user} />;
  }

  const Page = route.component;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Page />
    </Suspense>
  );
}

/**
 * Everything cached client-side (provider lists, kept-alive screens, counts)
 * belongs to one signed-in user. Keying on the user id discards it all on
 * logout or account switch — the app layout no longer remounts between
 * routes, so nothing else would.
 */
function UserScope({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <Fragment key={user?.id ?? "anonymous"}>{children}</Fragment>;
}

export default function ClientApp({ initialUser }: { initialUser: User | null }) {
  return (
    <AuthProvider initialUser={initialUser}>
      <UserScope>
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
      </UserScope>
    </AuthProvider>
  );
}
