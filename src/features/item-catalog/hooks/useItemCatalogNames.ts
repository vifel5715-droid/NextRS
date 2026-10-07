import { useEffect, useState } from "react";
import { itemCatalogAPI } from "../../../services/api";

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
    itemCatalogAPI
      .getAll()
      .then((res) => {
        if (cancelled) return;
        setNames(Array.from(new Set(res.data.map((entry) => entry.item_name))).sort());
      })
      .catch(() => {
        // silently ignore — existence-status/autocomplete is a soft assist, not critical path
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
};
