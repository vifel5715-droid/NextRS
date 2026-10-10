"use server";

import { sql } from "drizzle-orm";
import { getCurrentUser } from "../auth/session";
import { getDb } from "../db";
import { itemRequests } from "../db/schema";

const MAX_ATTACHMENT_BYTES = 10.5 * 1024 * 1024;

export interface AttachmentStorageUsage {
  used: number;
  max: number;
}

export async function getAttachmentStorageUsageAction(): Promise<AttachmentStorageUsage> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  if (!user.permissions.includes("create_request")) {
    throw new Error("Permission denied.");
  }

  const [usage] = await getDb()
    .select({
      used: sql<number>`COALESCE(SUM(${itemRequests.attachment_size}), 0)::int`,
    })
    .from(itemRequests);

  return {
    used: Number(usage?.used ?? 0),
    max: MAX_ATTACHMENT_BYTES,
  };
}
