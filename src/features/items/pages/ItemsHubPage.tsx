import React, { useState } from "react";
import { useLocation, useSearchParams } from "@shared/next-router";
import Layout from "@shared/components/Layout";
import { useAuth } from "@app/providers/AuthProvider";
import HeldItemsPage from "./HeldItemsPage";
import ItemListPage from "./ItemListPage";
import OutedItemsPage from "./OutedItemsPage";

type HubTab = "held" | "item-list" | "outed";

const VALID_TABS: HubTab[] = ["held", "item-list", "outed"];

// The three old routes (still linked from MainDashboardPage's tiles, and
// bookmarks) each land on the matching tab of this merged page instead of
// their own standalone screen — see App.tsx, which now points all three at
// this component.
const PATH_TO_TAB: Record<string, HubTab> = {
  "/dashboard/held-items": "held",
  "/dashboard/item-list": "item-list",
  "/dashboard/outed-items": "outed",
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
  // Held Items has never been visible to staff (see Sidebar/App.tsx's role
  // lists) — that stays true here: staff simply never gets the tab. A custom
  // role reaches this branch via its held_items permission instead, since it
  // won't match any of these hardcoded built-in role names.
  const canSeeHeld =
    ["secretary", "supervisor", "manager", "custodian", "admin", "director"].includes(
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
