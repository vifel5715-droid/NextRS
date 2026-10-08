"use server";

import { eq } from "drizzle-orm";
import type { ItemCatalogEntry, OptionListEntry } from "@shared/types";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemCatalog, optionLists } from "../db/schema";

export type OptionListKind = OptionListEntry["kind"];

const OPTION_LIST_KINDS: readonly OptionListKind[] = [
  "item_type",
  "uom",
  "machine_code",
  "item_group",
  "department",
];

function isOptionListKind(value: string): value is OptionListKind {
  return OPTION_LIST_KINDS.some((kind) => kind === value);
}

async function requireAuthenticatedUser(): Promise<void> {
  if (!(await getCurrentUser())) {
    throw new Error("Authentication required.");
  }
}

function toOptionListEntry(row: {
  id: number;
  kind: string;
  value: string;
  description: string | null;
  created_at: string;
}): OptionListEntry {
  if (!isOptionListKind(row.kind)) {
    throw new Error(`Unexpected option list kind in database: ${row.kind}`);
  }
  return { ...row, kind: row.kind };
}

export async function getOptionListAction(kind: OptionListKind): Promise<OptionListEntry[]> {
  if (!isOptionListKind(kind)) {
    throw new Error("Invalid option list kind.");
  }

  await requireAuthenticatedUser();
  const rows = await getDb()
    .select({
      id: optionLists.id,
      kind: optionLists.kind,
      value: optionLists.value,
      description: optionLists.description,
      created_at: optionLists.created_at,
    })
    .from(optionLists)
    .where(eq(optionLists.kind, kind));

  return rows.map(toOptionListEntry);
}

export async function getItemCatalogAction(): Promise<ItemCatalogEntry[]> {
  await requireAuthenticatedUser();
  const rows = await getDb().select().from(itemCatalog);

  return rows.map((row) => {
    if (
      row.approval_level !== "MANAGER_ONLY" &&
      row.approval_level !== "SUPERVISOR_OR_MANAGER"
    ) {
      throw new Error(`Unexpected item catalog approval level in database: ${row.approval_level}`);
    }
    return { ...row, approval_level: row.approval_level };
  });
}
