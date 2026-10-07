/**
 * Exports an array of plain objects to a downloaded .xlsx file — one row per
 * object, one column per key in `columns` (in that order). Used by the list
 * toolbars (Pending Items, Held Items, Pending Services, Delivered Items) to
 * export whatever's currently visible (i.e. already search-filtered).
 *
 * `xlsx` is a large library (~400KB) that every page with an export button
 * would otherwise pull into its initial bundle just to have this function
 * available — loaded here on demand instead, only when a user actually
 * clicks "Convert to Excel", so it never delays first paint/LCP.
 */
export async function exportToExcel<T extends Record<string, unknown>>(
  filename: string,
  columns: { key: keyof T; label: string }[],
  rows: T[]
): Promise<void> {
  const XLSX = await import("xlsx");
  const worksheetData = [
    columns.map((c) => c.label),
    ...rows.map((row) => columns.map((c) => row[c.key] ?? "")),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  // Rough auto-width so columns aren't all squeezed to the header's width —
  // XLSX has no native "autofit", this just approximates it from content length.
  worksheet["!cols"] = columns.map((c) => ({
    wch: Math.min(60, Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)) + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
