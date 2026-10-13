import { useEffect, useState } from "react";
import { getItemCatalogAction } from "@/features/item-master/actions/reference-data";
import type { ItemCatalogEntry } from "@/types";

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
    getItemCatalogAction()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((error: unknown) => {
        console.error("Failed to load item catalog entries", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
};
