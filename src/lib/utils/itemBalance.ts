export function getItemBalance(
  item: { quantity: number; quantity_out?: number | null },
  quantityOutNow = 0
): number {
  return Math.max(0, item.quantity - (item.quantity_out ?? 0) - quantityOutNow);
}
