import { NextResponse } from "next/server";

function notMigrated() {
  return NextResponse.json(
    { error: "This endpoint has not been migrated to a Next.js Server Action." },
    { status: 501 }
  );
}

export const GET = notMigrated;
export const HEAD = notMigrated;
export const POST = notMigrated;
export const PUT = notMigrated;
export const PATCH = notMigrated;
export const DELETE = notMigrated;
export const OPTIONS = notMigrated;
