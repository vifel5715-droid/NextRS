import "server-only";

import { inArray, sql } from "drizzle-orm";
import { itemCatalog } from "@/db/schema";
import type { Transaction } from "@/server/audit/adjustments";
import { catalogUomLookup, normalizeCatalogKey } from "@/lib/utils/catalogUom";

/** Loads the catalog rows for `itemNames` and returns catalogUomLookup over them. */
export async function loadCatalogUoms(
  tx: Transaction,
  department: string,
  itemNames: readonly string[]
): Promise<(itemName: string) => string | undefined> {
  const names = Array.from(new Set(itemNames.map(normalizeCatalogKey).filter(Boolean)));
  if (names.length === 0) return () => undefined;

  const rows = await tx
    .select({ item_name: itemCatalog.item_name, uom: itemCatalog.uom, departments: itemCatalog.departments })
    .from(itemCatalog)
    .where(inArray(sql`upper(trim(${itemCatalog.item_name}))`, names));
  return catalogUomLookup(rows, department);
}
