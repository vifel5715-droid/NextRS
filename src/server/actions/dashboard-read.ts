"use server";

import { and, count, gte, lte } from "drizzle-orm";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemCatalog } from "../db/schema";

function validateTimestamp(value: string | undefined): value is string | undefined {
  if (value === undefined) return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export async function getItemCatalogCountAction(
  startAt?: string,
  endAt?: string
): Promise<number> {
  if (!validateTimestamp(startAt) || !validateTimestamp(endAt)) {
    throw new Error("Invalid date range.");
  }
  if (startAt && endAt && startAt > endAt) {
    throw new Error("Start date must not be after end date.");
  }
  if (!(await getCurrentUser())) throw new Error("Authentication required.");

  const dateFilters = [];
  if (startAt) dateFilters.push(gte(itemCatalog.created_at, startAt));
  if (endAt) dateFilters.push(lte(itemCatalog.created_at, endAt));

  const [result] = await getDb()
    .select({ value: count() })
    .from(itemCatalog)
    .where(dateFilters.length ? and(...dateFilters) : undefined);
  return result.value;
}
