import { useEffect, useState } from "react";
import { itemCatalogAPI } from "../../../services/api";
import type { ItemCatalogEntry } from "@shared/types";

/**
 * The full item catalog (see db/schema.ts's itemCatalog), for forms that need
 * more than just the name list — e.g. auto-filling a request line's UoM once
 * its item name exactly matches a catalog entry. Fetched once per mount; the
 * catalog changes rarely enough (custodian-maintained) that a live
 * subscription isn't worth it.
 */
export const useItemCatalogEntries = () => {
  const [entries, setEntries] = useState<ItemCatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    itemCatalogAPI
      .getAll()
      .then((res) => {
        if (!cancelled) setEntries(res.data);
      })
      .catch(() => {
        // silently ignore — existence-status/autocomplete is a soft assist, not critical path
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
};
