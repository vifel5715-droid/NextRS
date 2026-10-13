import { useEffect, useState } from "react";
import { getItemCatalogAction } from "@/features/item-master/actions/reference-data";

/**
 * Distinct item names from the item catalog (see db/schema.ts's itemCatalog)
 * — backs the searchable Item Name field and the existence-status check on
 * request-creation forms. Fetched once per mount; the catalog changes rarely
 * enough (custodian-maintained) that a live subscription isn't worth it.
 */
export const useItemCatalogNames = () => {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getItemCatalogAction()
      .then((data) => {
        if (cancelled) return;
        setNames(Array.from(new Set(data.map((entry) => entry.item_name))).sort());
      })
      .catch((error: unknown) => {
        console.error("Failed to load item catalog names", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
};
