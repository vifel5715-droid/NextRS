export type CatalogUomRow = { item_name: string; uom: string; departments: string | null };

export const normalizeCatalogKey = (value: string) => value.trim().toUpperCase();

/**
 * Item List (item_catalog) is the authority for an item's UoM: an IRS line
 * whose name exactly matches a catalog entry (case-insensitive, trimmed) uses
 * that entry's UoM. Returns undefined when the name isn't in the catalog — a
 * genuinely new, free-typed item keeps the UoM the requester chose.
 *
 * Entries restricted to other departments are ignored, matching what the
 * request form offers that department. If the visible entries for a name
 * disagree on UoM (duplicate catalog rows), there is no single authority and
 * the lookup returns undefined.
 */
export function catalogUomLookup(
  rows: readonly CatalogUomRow[],
  department: string
): (itemName: string) => string | undefined {
  const dept = normalizeCatalogKey(department);
  const uomsByName = new Map<string, Set<string>>();
  for (const row of rows) {
    const allowed = row.departments ? row.departments.split(",").map(normalizeCatalogKey).filter(Boolean) : [];
    if (allowed.length > 0 && !allowed.includes(dept)) continue;
    const key = normalizeCatalogKey(row.item_name);
    const set = uomsByName.get(key) ?? new Set<string>();
    set.add(row.uom.trim());
    uomsByName.set(key, set);
  }

  return (itemName) => {
    const uoms = uomsByName.get(normalizeCatalogKey(itemName));
    return uoms?.size === 1 ? uoms.values().next().value : undefined;
  };
}
