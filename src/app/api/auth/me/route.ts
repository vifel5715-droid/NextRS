import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in user and their permissions, or 401. */
export const GET = withApiHandler(async () => {
  const { roleKey: _roleKey, ...user } = await requireUser();
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
});
