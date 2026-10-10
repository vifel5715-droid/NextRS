import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getReimbursementRequestsAction } from "@server/actions/special-requests";
import { getCurrentUser } from "@server/auth/session";
import { getDb } from "@server/db";
import { reimbursementRequests } from "@server/db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid request ID." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (
    !["create_request", "supervisor_dashboard", "purchaser_dashboard", "ap_officer_dashboard"]
      .some((permission) => user.permissions.includes(permission))
  ) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  const authorizedRequests = await getReimbursementRequestsAction();
  if (!authorizedRequests.some((request) => request.id === id)) {
    return NextResponse.json({ error: "Reimbursement request not found." }, { status: 404 });
  }

  const [request] = await getDb()
    .select({
      attachment_name: reimbursementRequests.attachment_name,
      attachment_data: reimbursementRequests.attachment_data,
    })
    .from(reimbursementRequests)
    .where(eq(reimbursementRequests.id, id))
    .limit(1);

  if (!request?.attachment_data || !request.attachment_name) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const safeName = request.attachment_name.replace(/[\\/"\x00-\x1F\x7F]/g, "_");
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, "_");
  return new NextResponse(new Uint8Array(request.attachment_data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Content-Length": String(request.attachment_data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
