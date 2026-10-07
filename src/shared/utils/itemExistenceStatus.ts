export type ExistenceStatus = "existing" | "not_found";

/**
 * Compares a typed item name against the item catalog: an exact match
 * (case-insensitive, trimmed) is "existing" — anything else is "not_found",
 * even a near-identical name. Partial/substring matching was tried and
 * rejected: a name that only "sounds similar" isn't a real record, and
 * showing it as such is misleading. Returns null for an empty/untyped name —
 * there's nothing to check yet.
 */
export const getItemExistenceStatus = (
  itemName: string,
  catalogNames: readonly string[]
): ExistenceStatus | null => {
  const query = itemName.trim().toUpperCase();
  if (!query) return null;

  const isExisting = catalogNames.some((name) => name.trim().toUpperCase() === query);
  return isExisting ? "existing" : "not_found";
};

export const EXISTENCE_STATUS_META: Record<ExistenceStatus, { label: string; color: string }> = {
  existing: { label: "Existing", color: "#22c55e" },
  not_found: { label: "Not Found", color: "#ef4444" },
};
