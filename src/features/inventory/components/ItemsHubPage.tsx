import React, { useState } from "react";
import { useLocation, useSearchParams } from "@/lib/next-router";
import Layout from "@/components/layout/Layout";
import { useAuth } from "@/components/providers/AuthProvider";
import HeldItemsPage from "@/features/inventory/components/HeldItemsPage";
import ItemListPage from "@/features/inventory/components/ItemListPage";
import OutedItemsPage from "@/features/inventory/components/OutedItemsPage";

type HubTab = "held" | "item-list" | "outed";

const VALID_TABS: HubTab[] = ["held", "item-list", "outed"];

// The three old routes (still linked from MainDashboardPage's tiles, and
// bookmarks) each land on the matching tab of this merged page instead of
// their own standalone screen — see App.tsx, which now points all three at
// this component.
const PATH_TO_TAB: Record<string, HubTab> = {
  "/inventory/held": "held",
  "/inventory": "item-list",
  "/inventory/issued": "outed",
};

/**
 * Held Items / Item List / Issued List of Item, merged into one sidebar
 * entry with three tabs — mirrors the earlier Pending Purchase Items &
 * Services merge, but composes the three existing page components directly
 * (each stripped of its own <Layout>) rather than rewriting their content,
 * since all three are large, independent, and otherwise unchanged.
 */
const ItemsHubPage: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  // Staff see the tab read-only: the list is scoped server-side to their own
  // requests, and HeldItemsPage shows no edit controls for staff (the HOLD
  // fix itself stays with Secretary/Supervisor/Manager). A custom role
  // reaches this branch via its held_items permission instead, since it
  // won't match any of these hardcoded built-in role names.
  const canSeeHeld =
    ["staff", "secretary", "supervisor", "manager", "custodian", "admin", "director"].includes(
      user?.role?.toLowerCase().trim() ?? ""
    ) || (user?.permissions.includes("held_items") ?? false);

  const tabFromQuery = searchParams.get("tab");
  const requestedTab: HubTab =
    (tabFromQuery && (VALID_TABS as string[]).includes(tabFromQuery) ? (tabFromQuery as HubTab) : null) ||
    PATH_TO_TAB[location.pathname] ||
    "item-list";
  const [activeTab, setActiveTab] = useState<HubTab>(
    requestedTab === "held" && !canSeeHeld ? "item-list" : requestedTab
  );

  return (
    <Layout>
      <div className="dash-tabs mb-4">
        {canSeeHeld && (
          <button
            className={`dash-tab ${activeTab === "held" ? "active" : ""}`}
            onClick={() => setActiveTab("held")}
          >
            Held Items
          </button>
        )}
        <button
          className={`dash-tab ${activeTab === "item-list" ? "active" : ""}`}
          onClick={() => setActiveTab("item-list")}
        >
          Item List
        </button>
        <button
          className={`dash-tab ${activeTab === "outed" ? "active" : ""}`}
          onClick={() => setActiveTab("outed")}
        >
          Issued List of Item
        </button>
      </div>

      {activeTab === "held" && canSeeHeld && <HeldItemsPage />}
      {activeTab === "item-list" && <ItemListPage />}
      {activeTab === "outed" && <OutedItemsPage />}
    </Layout>
  );
};

export default ItemsHubPage;
