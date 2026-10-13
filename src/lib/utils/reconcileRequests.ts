/**
 * Patches a realtime-pushed row into local list state without a network
 * round-trip: replaces the matching row in place (preserving its
 * created_at-desc position), or prepends it if it's genuinely new.
 */
export function upsertById<T extends { id: number }>(list: T[], row: T): T[] {
  const idx = list.findIndex((r) => r.id === row.id);
  if (idx === -1) return [row, ...list];
  const next = [...list];
  next[idx] = row;
  return next;
}

export function removeById<T extends { id: number }>(list: T[], id: number): T[] {
  if (!list.some((r) => r.id === id)) return list;
  return list.filter((r) => r.id !== id);
}
