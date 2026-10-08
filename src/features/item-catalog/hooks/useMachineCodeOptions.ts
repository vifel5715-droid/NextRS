import { useCallback, useEffect, useMemo, useState } from "react";
import { optionListAPI } from "../../../services/api";
import type { OptionListEntry } from "@shared/types";
import { getOptionListAction } from "@server/actions/reference-data";

const sortByValue = (list: OptionListEntry[]) => [...list].sort((a, b) => a.value.localeCompare(b.value));

/**
 * Loads and manages the Machine Code option list (see the ARCH note on
 * db/schema.ts's optionLists) shared by every item-request line-item table's
 * Machine Code SearchableCombobox. Typing a value that isn't here yet and
 * using it adds it here too (see addOption), so the list grows from actual
 * usage the same way Item Type/UoM do on the item catalog form.
 */
export function useMachineCodeOptions() {
  const [entries, setEntries] = useState<OptionListEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getOptionListAction("machine_code")
      .then((data) => { if (!cancelled) setEntries(sortByValue(data)); })
      .catch((err) => console.error("Failed to load machine code options", err));
    return () => { cancelled = true; };
  }, []);

  const options = entries.map((o) => o.value);

  // Value -> description (e.g. "AGITATOR" -> "Agitator 1"), keyed uppercase
  // since values are always stored/compared that way. SearchableCombobox
  // shows this as a subtitle under each suggestion so picking a code isn't
  // guesswork.
  const descriptions = useMemo(
    () => Object.fromEntries(entries.filter((o) => o.description).map((o) => [o.value.toUpperCase(), o.description as string])),
    [entries]
  );

  const addOption = useCallback(async (value: string): Promise<string | undefined> => {
    try {
      const res = await optionListAPI.create("machine_code", value);
      setEntries((prev) => (prev.some((o) => o.id === res.data.id) ? prev : sortByValue([...prev, res.data])));
      return res.data.value;
    } catch (err) {
      console.error("Failed to add machine code option", err);
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
      console.error("Failed to rename machine code option", err);
    }
  }, [entries]);

  const deleteOption = useCallback(async (value: string) => {
    const target = entries.find((o) => o.value.toUpperCase() === value.toUpperCase());
    if (!target) return;
    if (!confirm(`Remove "${value}" from the Machine Code option list?`)) return;
    try {
      await optionListAPI.delete(target.id);
      setEntries((prev) => prev.filter((o) => o.id !== target.id));
    } catch (err) {
      console.error("Failed to delete machine code option", err);
    }
  }, [entries]);

  return { options, descriptions, addOption, editOption, deleteOption };
}
