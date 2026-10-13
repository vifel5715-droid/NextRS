import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe. Deliberately does not touch the database: a brief database
 * outage should not make the host restart a healthy app process.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Request Management System API",
  });
}
