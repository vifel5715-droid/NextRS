import { useCallback, useEffect, useState } from "react";
import { optionListAPI } from "../../../services/api";
import type { OptionListEntry } from "@shared/types";
import { getOptionListAction } from "@server/actions/reference-data";

const sortByValue = (list: OptionListEntry[]) => [...list].sort((a, b) => a.value.localeCompare(b.value));

/**
 * Loads and manages the Item Group option list (see the ARCH note on
 * db/schema.ts's optionLists) for the item catalog form's Item Group field —
 * mirrors useMachineCodeOptions, minus descriptions (Item Group values are
 * self-explanatory, same as Item Type/UoM). Seeded from the external
 * accounting system's own Item Group list (see
 * migrate/add-item-group-options.ts); typing a value that isn't here yet and
 * using it adds it here too, same as every other option list.
 */
export function useItemGroupOptions() {
  const [entries, setEntries] = useState<OptionListEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getOptionListAction("item_group")
      .then((data) => { if (!cancelled) setEntries(sortByValue(data)); })
      .catch((err) => console.error("Failed to load item group options", err));
    return () => { cancelled = true; };
  }, []);

  const options = entries.map((o) => o.value);

  const addOption = useCallback(async (value: string): Promise<string | undefined> => {
    try {
      const res = await optionListAPI.create("item_group", value);
      setEntries((prev) => (prev.some((o) => o.id === res.data.id) ? prev : sortByValue([...prev, res.data])));
      return res.data.value;
    } catch (err) {
      console.error("Failed to add item group option", err);
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
      console.error("Failed to rename item group option", err);
    }
  }, [entries]);

  const deleteOption = useCallback(async (value: string) => {
    const target = entries.find((o) => o.value.toUpperCase() === value.toUpperCase());
    if (!target) return;
    if (!confirm(`Remove "${value}" from the Item Group option list?`)) return;
    try {
      await optionListAPI.delete(target.id);
      setEntries((prev) => prev.filter((o) => o.id !== target.id));
    } catch (err) {
      console.error("Failed to delete item group option", err);
    }
  }, [entries]);

  return { options, addOption, editOption, deleteOption };
}
