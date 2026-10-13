import { eq } from "drizzle-orm";
import { getReimbursementRequestsAction } from "@/features/requests/actions/special-requests";
import { attachmentError, attachmentResponse } from "@/server/services/attachment-response";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { reimbursementRequests } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, params: Promise<{ id: string }>, headOnly: boolean): Promise<Response> {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return attachmentError("Invalid request ID.", 400);

  const user = await getCurrentUser();
  if (!user) return attachmentError("Your session has expired. Please log in again.", 401);
  if (
    !["create_request", "supervisor_dashboard", "purchaser_dashboard", "ap_officer_dashboard"]
      .some((permission) => user.permissions.includes(permission))
  ) {
    return attachmentError("Permission denied.", 403);
  }

  const authorizedRequests = await getReimbursementRequestsAction();
  if (!authorizedRequests.some((entry) => entry.id === id)) {
    return attachmentError("You do not have access to this request's attachment.", 403);
  }

  const [row] = await getDb()
    .select({
      attachment_name: reimbursementRequests.attachment_name,
      attachment_data: reimbursementRequests.attachment_data,
    })
    .from(reimbursementRequests)
    .where(eq(reimbursementRequests.id, id))
    .limit(1);

  if (!row?.attachment_data || !row.attachment_name) {
    return attachmentError("This request has no attachment.", 404);
  }
  return attachmentResponse(request, { name: row.attachment_name, data: row.attachment_data }, headOnly);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, true);
}
