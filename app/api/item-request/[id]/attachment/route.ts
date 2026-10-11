import { eq } from "drizzle-orm";
import { getItemRequestByIdAction } from "@server/actions/request-lists";
import { attachmentError, attachmentResponse, readLegacyAttachment } from "@server/attachment-response";
import { getCurrentUser } from "@server/auth/session";
import { getDb } from "@server/db";
import { itemRequests } from "@server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens (or with ?download=1, downloads) an Item Request's supporting PDF.
 *
 * Before this route existed, every attachment click went to the
 * not-yet-migrated `/api/[...path]` catch-all, which always answered 501 —
 * hence "Failed to open attachment". Access is decided by the same rule as
 * reading the request itself (getItemRequestByIdAction), so anyone who can
 * see a request can open its document and nobody else can.
 */
async function handle(request: Request, params: Promise<{ id: string }>, headOnly: boolean): Promise<Response> {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return attachmentError("Invalid request ID.", 400);

  const user = await getCurrentUser();
  if (!user) return attachmentError("Your session has expired. Please log in again.", 401);

  try {
    await getItemRequestByIdAction(id);
  } catch {
    return attachmentError("You do not have access to this request's attachment.", 403);
  }

  const [row] = await getDb()
    .select({
      attachment: itemRequests.attachment,
      attachment_name: itemRequests.attachment_name,
      attachment_data: itemRequests.attachment_data,
      attachment_mime: itemRequests.attachment_mime,
    })
    .from(itemRequests)
    .where(eq(itemRequests.id, id))
    .limit(1);
  if (!row) return attachmentError("Request not found.", 404);

  const data = row.attachment_data ?? (await readLegacyAttachment(row.attachment));
  if (!data) {
    return attachmentError(
      row.attachment_name || row.attachment
        ? "The attachment file is missing on the server. Please upload it again."
        : "This request has no attachment.",
      404
    );
  }
  return attachmentResponse(
    request,
    { name: row.attachment_name || row.attachment || `request-${id}.pdf`, data, mime: row.attachment_mime },
    headOnly
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, true);
}
