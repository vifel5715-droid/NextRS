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

/**
 * Per-type count of events delivered so far. A subscriber that pauses (a
 * kept-alive screen hidden by the app shell tears its effects down) records
 * a snapshot, and on resubscribing is replayed a refetch signal for exactly
 * the types that changed in between — nothing if nothing changed.
 */
const changeSeq: Record<RequestType, number> = { item: 0, service: 0, urgent: 0, reimbursement: 0 };
export type ChangeSnapshot = Readonly<Record<RequestType, number>>;

export const getChangeSnapshot = (): ChangeSnapshot => ({ ...changeSeq });

export function replayChangesSince(
  snapshot: ChangeSnapshot,
  cb: (payload: RequestChangedPayload) => void
): void {
  for (const type of REQUEST_TYPES) {
    if (changeSeq[type] === snapshot[type]) continue;
    try {
      cb({ type, action: "updated", id: 0 } as RequestChangedPayload);
    } catch (error) {
      console.error("Realtime listener failed:", error);
    }
  }
}

function emit(payload: RequestChangedPayload): void {
  changeSeq[payload.type] += 1;
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

let retryTimer: ReturnType<typeof setTimeout> | null = null;
const CLOSED_RETRY_MS = 15_000;

function connect(): void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  if (source && source.readyState !== EventSource.CLOSED) return;
  source?.close();
  source = new EventSource(EVENTS_URL, { withCredentials: true });
  source.addEventListener("error", () => {
    // A 401 (e.g. subscribed on the login page, or the session expired)
    // closes the EventSource for good. Drop it and retry later so the
    // stream comes back once the user is logged in.
    if (source?.readyState !== EventSource.CLOSED) return;
    source = null;
    if (!retryTimer && listeners.size > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (listeners.size > 0) connect();
      }, CLOSED_RETRY_MS);
    }
  });
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
  // EventSource reconnects on its own after a dropped connection (server
  // sends `retry: 5000`); the "error" handler above covers HTTP errors. The
  // "ready" handler resyncs after any reconnect.
}

function disconnect(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  source?.close();
  source = null;
  hasConnected = false;
}

// Brief zero-subscriber gaps (e.g. login handing over to the dashboard shell)
// shouldn't tear the stream down and reopen it a moment later.
const IDLE_DISCONNECT_MS = 10_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export const subscribeRequestChanged = (
  cb: (payload: RequestChangedPayload) => void
): (() => void) => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  listeners.add(cb);
  connect();
  return () => {
    listeners.delete(cb);
    if (listeners.size > 0 || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (listeners.size === 0) disconnect();
    }, IDLE_DISCONNECT_MS);
  };
};
