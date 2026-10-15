import { compressedJson, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getItemRequestByIdAction, getServiceRequestByIdAction } from "@/features/requests/actions/request-lists";
import { requestIdParamSchema, requestTypeSchema } from "@/features/requests/schemas/request-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/requests/:requestId?type=item|service (default item)
 *
 * 404 when the request does not exist or the caller may not see it — the two
 * are deliberately indistinguishable.
 */
export const GET = withApiHandler<{ params: Promise<{ requestId: string }> }>(async (request, { params }) => {
  await requireUser();
  const id = requestIdParamSchema.parse((await params).requestId);
  const type = requestTypeSchema.parse(new URL(request.url).searchParams.get("type") ?? "item");
  const data = type === "item" ? await getItemRequestByIdAction(id) : await getServiceRequestByIdAction(id);
  return compressedJson(request, { request: data }, { headers: { "Cache-Control": "no-store" } });
});
