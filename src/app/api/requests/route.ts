import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getMyRequestListsAction, getRequestListsAction } from "@/features/requests/actions/request-lists";
import { requestListQuerySchema } from "@/features/requests/schemas/request-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/requests?type=item|service&scope=all|own
 *
 * Item and service requests visible to the caller. Department scoping and
 * permission checks are the same code path the dashboards use
 * (features/requests/actions/request-lists.ts).
 */
export const GET = withApiHandler(async (request) => {
  await requireUser();
  const url = new URL(request.url);
  const query = requestListQuerySchema.parse({
    type: url.searchParams.get("type") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
  });
  const lists = query.scope === "own" ? await getMyRequestListsAction() : await getRequestListsAction();
  const body =
    query.type === "item"
      ? { itemRequests: lists.itemRequests }
      : query.type === "service"
        ? { serviceRequests: lists.serviceRequests }
        : lists;
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
});
