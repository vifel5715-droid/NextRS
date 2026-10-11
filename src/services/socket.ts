import type {
  ItemRequest,
  ReimbursementRequest,
  ServiceRequest,
  UrgentRequest,
} from "@shared/types";

type ChangedAction = "created" | "updated" | "deleted";
type RequestType = "item" | "service" | "urgent" | "reimbursement";

/**
 * A request-change notification. The realtime channel (see
 * server/realtime.ts and app/api/events/route.ts) only ever carries
 * identifiers — `data` is never filled in by the server — so subscribers
 * refetch through their normal, authorized Server Actions. `data` stays in
 * the type because the list hooks still accept an already-projected row.
 */
export type RequestChangedPayload =
  | { type: "item"; action: ChangedAction; id: number; department?: string | null; data?: ItemRequest }
  | { type: "service"; action: ChangedAction; id: number; department?: string | null; data?: ServiceRequest }
  | { type: "urgent"; action: ChangedAction; id: number; department?: string | null; data?: UrgentRequest }
  | { type: "reimbursement"; action: ChangedAction; id: number; department?: string | null; data?: ReimbursementRequest }
  | { type: RequestType; action: "deleted"; id: number; department?: string | null; data?: undefined };

const listeners = new Set<(payload: RequestChangedPayload) => void>();
const REQUEST_TYPES: readonly RequestType[] = ["item", "service", "urgent", "reimbursement"];
const EVENTS_URL = "/api/events";

let source: EventSource | null = null;
let hasConnected = false;

function emit(payload: RequestChangedPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error("Realtime listener failed:", error);
    }
  }
}

/**
 * After a reconnect, anything published while disconnected was missed — send
 * every subscriber a data-less "updated" for each type so they refetch.
 * id 0 never matches an open detail panel, so only lists reload.
 */
function emitResync(): void {
  for (const type of REQUEST_TYPES) emit({ type, action: "updated", id: 0 } as RequestChangedPayload);
}

function isPayload(value: unknown): value is RequestChangedPayload {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    REQUEST_TYPES.includes(event.type as RequestType) &&
    (event.action === "created" || event.action === "updated" || event.action === "deleted") &&
    typeof event.id === "number"
  );
}

function connect(): void {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  source = new EventSource(EVENTS_URL, { withCredentials: true });
  source.addEventListener("ready", () => {
    if (hasConnected) emitResync();
    hasConnected = true;
  });
  source.addEventListener("resync", emitResync);
  source.addEventListener("change", (event) => {
    try {
      const payload: unknown = JSON.parse((event as MessageEvent<string>).data);
      // petty_cash/catalog events have no list hook subscribed through this
      // channel; isPayload filters them out.
      if (isPayload(payload)) emit({ ...payload, data: undefined } as RequestChangedPayload);
    } catch {
      // Ignore malformed events.
    }
  });
  // EventSource reconnects on its own (server sends `retry: 5000`), except
  // after an HTTP error such as 401 — then it stays closed, which is right
  // for a logged-out session. The "ready" handler resyncs after reconnects.
}

function disconnect(): void {
  source?.close();
  source = null;
  hasConnected = false;
}

export const subscribeRequestChanged = (
  cb: (payload: RequestChangedPayload) => void
): (() => void) => {
  listeners.add(cb);
  connect();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) disconnect();
  };
};
