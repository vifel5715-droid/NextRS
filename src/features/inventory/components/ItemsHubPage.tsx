import React from "react";
import Layout from "@/components/layout/Layout";
import ItemListPage from "@/features/inventory/components/ItemListPage";

/**
 * The sidebar's Item List entry. It used to be a three-tab hub (Held
 * Services / Item List / Issued List of Item); the other two tabs were
 * removed, so it now shows only the Item List. /inventory/held and
 * /inventory/issued still route here (bookmarks, legacy redirects) and land
 * on the Item List too. HeldItemsPage and OutedItemsPage are kept on disk,
 * unused, along with their data and server actions.
 */
const ItemsHubPage: React.FC = () => (
  <Layout>
    <ItemListPage />
  </Layout>
);

export default ItemsHubPage;
