/**
 * Machine Code is required on every item request line item and must match
 * one of the registered option-list values (see useMachineCodeOptions) —
 * free-typing an unregistered code is no longer allowed now that the
 * per-row combobox no longer offers "+ Add as new option" (that's
 * ItemCatalogModal's job). Shared across every Create/Edit Item Request
 * form so the two error strings stay identical everywhere.
 */
export function getMachineCodeError(value: string | undefined, validCodes: ReadonlySet<string>): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return "Machine Code is required.";
  if (!validCodes.has(trimmed.toUpperCase())) return "Invalid Machine Code. Record not found.";
  return null;
}

/** True if every row's machine_code is present and registered. */
export function allMachineCodesValid(rows: Array<{ machine_code?: string }>, validCodes: ReadonlySet<string>): boolean {
  return rows.every((row) => getMachineCodeError(row.machine_code, validCodes) === null);
}

/**
 * Machine Code only applies to Engineering (ENGG) requests — every other
 * department gets the column disabled and skips its validation entirely.
 */
export const MACHINE_CODE_DEPARTMENT = "ENGG";

export function isMachineCodeEnabled(department: string | null | undefined): boolean {
  return (department || "").trim().toUpperCase() === MACHINE_CODE_DEPARTMENT;
}
