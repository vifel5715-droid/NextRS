import { useCallback, useEffect, useMemo, useState } from "react";
import { optionListAPI } from "@/lib/api";
import type { OptionListEntry } from "@/types";
import { getOptionListAction } from "@/features/item-master/actions/reference-data";

const sortByValue = (list: OptionListEntry[]) => [...list].sort((a, b) => a.value.localeCompare(b.value));

/**
 * Loads and manages the Department option list (see the ARCH note on
 * db/schema.ts's optionLists) shared by the Create/Edit User form
 * (AdminDashboard.tsx) and the item catalog's department-restriction
 * checkboxes (DepartmentCheckboxes.tsx). Admin-only to write (see
 * option-list.controller.ts's assertCanWriteKind) — every other role can
 * still read the list.
 */
export function useDepartmentOptions() {
  const [entries, setEntries] = useState<OptionListEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getOptionListAction("department")
      .then((data) => { if (!cancelled) setEntries(sortByValue(data)); })
      .catch((err) => console.error("Failed to load department options", err));
    return () => { cancelled = true; };
  }, []);

  const options = entries.map((o) => o.value);

  const descriptions = useMemo(
    () => Object.fromEntries(entries.filter((o) => o.description).map((o) => [o.value.toUpperCase(), o.description as string])),
    [entries]
  );

  const addOption = useCallback(async (value: string, description?: string): Promise<string | undefined> => {
    try {
      const res = await optionListAPI.create("department", value, description);
      setEntries((prev) => (prev.some((o) => o.id === res.data.id) ? prev : sortByValue([...prev, res.data])));
      return res.data.value;
    } catch (err) {
      console.error("Failed to add department option", err);
      return undefined;
    }
  }, []);

  const editOption = useCallback(async (oldValue: string, newValue: string) => {
    const target = entries.find((o) => o.value.toUpperCase() === oldValue.toUpperCase());
    if (!target) return;
    try {
      const res = await optionListAPI.update(target.id, newValue);
      setEntries((prev) => sortByValue(prev.map((o) => (o.id === target.id ? res.data : o))));
    } catch (err) {
      console.error("Failed to rename department option", err);
    }
  }, [entries]);

  const deleteOption = useCallback(async (value: string) => {
    const target = entries.find((o) => o.value.toUpperCase() === value.toUpperCase());
    if (!target) return;
    if (!confirm(`Remove "${value}" from the Department option list?`)) return;
    try {
      await optionListAPI.delete(target.id);
      setEntries((prev) => prev.filter((o) => o.id !== target.id));
    } catch (err) {
      console.error("Failed to delete department option", err);
    }
  }, [entries]);

  /** Id-keyed variants for a management table (DepartmentsTab.tsx), which
   * already has the row's id on hand and needs to update code + label
   * together rather than looking a row up by its (possibly stale) value. */
  const updateEntry = useCallback(async (id: number, value: string, description: string): Promise<boolean> => {
    try {
      const res = await optionListAPI.update(id, value, description);
      setEntries((prev) => sortByValue(prev.map((o) => (o.id === id ? res.data : o))));
      return true;
    } catch (err) {
      console.error("Failed to update department", err);
      return false;
    }
  }, []);

  const deleteEntry = useCallback(async (id: number): Promise<boolean> => {
    try {
      await optionListAPI.delete(id);
      setEntries((prev) => prev.filter((o) => o.id !== id));
      return true;
    } catch (err) {
      console.error("Failed to delete department", err);
      return false;
    }
  }, []);

  return { entries, options, descriptions, addOption, editOption, deleteOption, updateEntry, deleteEntry };
}
