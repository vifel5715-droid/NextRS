"use client";

import React, { Activity, Fragment, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/providers/AuthProvider";
import { DateRangeProvider } from "@/components/providers/DateRangeProvider";
import { DashboardCountsProvider } from "@/components/providers/DashboardCountsProvider";
import { OutedItemsProvider } from "@/components/providers/OutedItemsProvider";
import LoadingScreen from "@/components/layout/LoadingScreen";
import { ShellLayout } from "@/components/layout/Layout";
import type { User } from "@/types";

type PageComponent = React.ComponentType;

// Literal dynamic(() => import(...)) calls so Next can still emit SSR chunk
// preloads; `preload` below repeats the same specifiers so idle-time warming
// can fetch a page's chunk before its first visit (the bundler dedupes them).
const LoginPage = dynamic(() => import("@/features/auth/components/LoginPage"));
const UnauthorizedPage = dynamic(() => import("@/features/auth/components/UnauthorizedPage"));
const StaffDashboard = dynamic(() => import("@/features/requests/components/StaffDashboard"));
const SupervisorDashboard = dynamic(() => import("@/features/approvals/components/SupervisorDashboard"));
const PurchaserDashboard = dynamic(() => import("@/features/approvals/components/PurchaserDashboard"));
const APOfficerDashboard = dynamic(() => import("@/features/approvals/components/APOfficerDashboard"));
const PettyCashPage = dynamic(() => import("@/features/petty-cash/components/PettyCashPage"));
const CustodianDashboard = dynamic(() => import("@/features/approvals/components/CustodianDashboard"));
const AdminDashboard = dynamic(() => import("@/features/settings/components/AdminDashboard"));
const UrgentItemsPage = dynamic(() => import("@/features/inventory/components/UrgentItemsPage"));
const PendingItemEntryPage = dynamic(() => import("@/features/inventory/components/PendingItemEntryPage"));
const NewItemListPage = dynamic(() => import("@/features/inventory/components/NewItemListPage"));
const CompleteRequestsPage = dynamic(() => import("@/features/reports/components/CompleteRequestsPage"));
const SummaryRequestsPage = dynamic(() => import("@/features/reports/components/SummaryRequestsPage"));
const DeletedItemsPage = dynamic(() => import("@/features/reports/components/DeletedItemsPage"));
const ItemsHubPage = dynamic(() => import("@/features/inventory/components/ItemsHubPage"));
const AdjustmentHistoryPage = dynamic(() => import("@/features/reports/components/AdjustmentHistoryPage"));
const SubmittedPaymentRequestsPage = dynamic(() => import("@/features/purchase-requests/components/SubmittedPaymentRequestsPage"));
const MainDashboardPage = dynamic(() => import("@/features/dashboard/components/MainDashboardPage"));

// "Approval Requests" screens — the same pages in their approval mode, which
// list only requests not yet fully approved (see each page's approvalView).
const StaffApprovalRequests = () => <StaffDashboard approvalView />;
const CustodianApprovalRequests = () => <CustodianDashboard approvalView />;
// Cash Purchase Based on P.O., split by delivery status (see PettyCashPage).
const DeliveredCashPurchase = () => <PettyCashPage view="delivered" />;
// "Pending Requests" — the requester's fully approved, still-open requests,
// split out of the Create New Request screen (see StaffDashboard pendingView).
const StaffPendingRequests = () => <StaffDashboard pendingView />;

const preload = {
  staff: () => import("@/features/requests/components/StaffDashboard"),
  supervisor: () => import("@/features/approvals/components/SupervisorDashboard"),
  purchaser: () => import("@/features/approvals/components/PurchaserDashboard"),
  apOfficer: () => import("@/features/approvals/components/APOfficerDashboard"),
  pettyCash: () => import("@/features/petty-cash/components/PettyCashPage"),
  custodian: () => import("@/features/approvals/components/CustodianDashboard"),
  admin: () => import("@/features/settings/components/AdminDashboard"),
  urgentItems: () => import("@/features/inventory/components/UrgentItemsPage"),
  pendingItemEntry: () => import("@/features/inventory/components/PendingItemEntryPage"),
  newItemList: () => import("@/features/inventory/components/NewItemListPage"),
  completeRequests: () => import("@/features/reports/components/CompleteRequestsPage"),
  summaryRequests: () => import("@/features/reports/components/SummaryRequestsPage"),
  deletedItems: () => import("@/features/reports/components/DeletedItemsPage"),
  itemsHub: () => import("@/features/inventory/components/ItemsHubPage"),
  adjustmentHistory: () => import("@/features/reports/components/AdjustmentHistoryPage"),
  submittedPaymentRequests: () => import("@/features/purchase-requests/components/SubmittedPaymentRequestsPage"),
  overview: () => import("@/features/dashboard/components/MainDashboardPage"),
};

interface RouteDef {
  component: PageComponent;
  permission?: string;
  preload?: () => Promise<unknown>;
}

const routes: Record<string, RouteDef> = {
  "/login": { component: LoginPage },
  "/unauthorized": { component: UnauthorizedPage },
  "/requests": { component: StaffDashboard, permission: "create_request", preload: preload.staff },
  "/approvals": { component: SupervisorDashboard, permission: "supervisor_dashboard", preload: preload.supervisor },
  "/approvals/purchaser": { component: PurchaserDashboard, permission: "purchaser_dashboard", preload: preload.purchaser },
  "/approvals/ap-officer": { component: APOfficerDashboard, permission: "ap_officer_dashboard", preload: preload.apOfficer },
  "/petty-cash": { component: PettyCashPage, permission: "petty_cash", preload: preload.pettyCash },
  "/petty-cash/delivered": { component: DeliveredCashPurchase, permission: "petty_cash", preload: preload.pettyCash },
  "/approvals/custodian": { component: CustodianDashboard, permission: "department_requests", preload: preload.custodian },
  "/settings": { component: AdminDashboard, permission: "users_management", preload: preload.admin },
  "/approvals/all": { component: CustodianDashboard, permission: "department_requests", preload: preload.custodian },
  "/requests/new": { component: StaffDashboard, permission: "create_request", preload: preload.staff },
  "/requests/approval": { component: StaffApprovalRequests, permission: "create_request", preload: preload.staff },
  "/requests/pending": { component: StaffPendingRequests, permission: "create_request", preload: preload.staff },
  "/approvals/review": { component: CustodianApprovalRequests, permission: "department_requests", preload: preload.custodian },
  "/inventory/urgent-items": { component: UrgentItemsPage, permission: "urgent_items", preload: preload.urgentItems },
  "/inventory/pending-entry": { component: PendingItemEntryPage, permission: "pending_item_entry", preload: preload.pendingItemEntry },
  "/inventory/new-items": { component: NewItemListPage, permission: "new_item_list", preload: preload.newItemList },
  "/inventory/issued": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/reports": { component: CompleteRequestsPage, permission: "complete_requests", preload: preload.completeRequests },
  "/reports/summary": { component: SummaryRequestsPage, permission: "complete_requests", preload: preload.summaryRequests },
  "/reports/deleted": { component: DeletedItemsPage, permission: "deleted_items", preload: preload.deletedItems },
  "/inventory/held": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/inventory": { component: ItemsHubPage, permission: "item_list", preload: preload.itemsHub },
  "/purchase-requests/payment-requests": {
    component: SubmittedPaymentRequestsPage,
    permission: "submitted_payment_requests",
    preload: preload.submittedPaymentRequests,
  },
  "/reports/adjustments": { component: AdjustmentHistoryPage, permission: "adjustment_history", preload: preload.adjustmentHistory },
  "/dashboard": { component: MainDashboardPage, permission: "overview", preload: preload.overview },
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
          <OutedItemsProvider>
            <RouteContent />
          </OutedItemsProvider>
        </DateRangeProvider>
      </UserScope>
    </AuthProvider>
  );
}
