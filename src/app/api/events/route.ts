import { getCurrentUser } from "@/lib/session";
import { subscribeRequestChanged, type RequestChangeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
// Closing periodically makes EventSource reconnect, which re-runs the session
// check below — a logged-out or expired session stops receiving events.
const MAX_CONNECTION_MS = 15 * 60_000;

// Roles whose request lists span every department (see request-lists.ts's
// GLOBAL_REQUEST_ROLES); everyone else only receives their own department's
// events. Events only carry ids, so this is noise reduction, not the
// security boundary — the refetch that follows is separately authorized.
const ALL_DEPARTMENT_ROLES = new Set([
  "admin",
  "custodian",
  "director",
  "supervisor",
  "manager",
  "purchaser",
  "ap_officer",
  "operations_manager",
]);

/**
 * Server-Sent Events stream of request-change notifications. See
 * server/realtime.ts for the design.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const role = user.role.trim().toLowerCase();
  const department = user.department.trim().toUpperCase();
  const receivesEvent = (event: RequestChangeEvent) =>
    ALL_DEPARTMENT_ROLES.has(role) ||
    event.department === null ||
    event.department.trim().toUpperCase() === department;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = subscribeRequestChanged((event) => {
        if (event.type === "resync") {
          write(`event: resync\ndata: {}\n\n`);
        } else if (receivesEvent(event)) {
          write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
        }
      });
      const heartbeat = setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS);
      const lifetime = setTimeout(() => cleanup(), MAX_CONNECTION_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener("abort", cleanup);

      write(`retry: 5000\n\n`);
      write(`event: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // Stops `next start`'s gzip middleware from buffering the stream.
      "Content-Encoding": "none",
    },
  });
}
