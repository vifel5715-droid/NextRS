import "server-only";

import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";

/**
 * ARCH: realtime dashboard sync.
 *
 * The legacy Express backend pushed `request:changed` over Socket.IO; the
 * Next.js app had no publisher at all, so dashboards never refreshed until a
 * manual reload. `next start` cannot accept WebSocket upgrades without a
 * custom server, so this uses the two primitives the deployment already has:
 *
 *   - Postgres LISTEN/NOTIFY as the bus. A mutation calls
 *     publishRequestChanged() only AFTER its transaction has committed, so a
 *     rolled-back write never announces itself. Because the bus is the
 *     database, this keeps working if the Railway service is ever scaled to
 *     more than one instance.
 *   - Server-Sent Events (app/api/events/route.ts) to fan events out to
 *     browsers over plain HTTP.
 *
 * Events carry identifiers only (type/action/id/department) — never row
 * data — so nothing sensitive crosses the bus or reaches a browser that
 * could not already read it. Clients refetch through their normal,
 * authorized Server Actions. The database stays the source of truth.
 */
export type RealtimeType = "item" | "service" | "urgent" | "reimbursement" | "petty_cash" | "catalog";

export interface RequestChangeEvent {
  type: RealtimeType;
  action: "created" | "updated" | "deleted";
  id: number;
  department: string | null;
}

/** Synthetic event delivered to local listeners after the LISTEN connection was re-established — anything published during the gap was missed, so subscribers should refetch. */
export interface ResyncEvent {
  type: "resync";
}

type Listener = (event: RequestChangeEvent | ResyncEvent) => void;

const CHANNEL = "request_changed";
const RETRY_MS = 5_000;

export async function publishRequestChanged(event: RequestChangeEvent): Promise<void> {
  try {
    await getDb().execute(sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})`);
  } catch (error) {
    // A failed notification must never fail the (already committed) write.
    logger.error("Failed to publish realtime event", { error });
  }
}

interface SubscriberState {
  listeners: Set<Listener>;
  client: Client | null;
  connecting: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  hasConnectedBefore: boolean;
}

const globalState = globalThis as typeof globalThis & { requestSystemRealtime?: SubscriberState };
const state: SubscriberState = (globalState.requestSystemRealtime ??= {
  listeners: new Set(),
  client: null,
  connecting: false,
  retryTimer: null,
  hasConnectedBefore: false,
});

function isChangeEvent(value: unknown): value is RequestChangeEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.type === "string" &&
    typeof event.action === "string" &&
    typeof event.id === "number" &&
    (event.department === null || typeof event.department === "string")
  );
}

function dispatch(event: RequestChangeEvent | ResyncEvent): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error("Realtime listener failed", { error });
    }
  }
}

function scheduleRetry(): void {
  if (state.retryTimer || state.listeners.size === 0) return;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    void connect();
  }, RETRY_MS);
}

function drop(client: Client): void {
  if (state.client !== client) return;
  state.client = null;
  client.removeAllListeners();
  client.end().catch(() => {});
  scheduleRetry();
}

async function connect(): Promise<void> {
  if (state.client || state.connecting || state.listeners.size === 0) return;
  state.connecting = true;
  const client = new Client({ connectionString: env.DATABASE_URL });
  try {
    client.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try {
        const parsed: unknown = JSON.parse(message.payload);
        if (isChangeEvent(parsed)) dispatch(parsed);
      } catch {
        // Ignore malformed payloads.
      }
    });
    client.on("error", (error) => {
      logger.error("Realtime LISTEN connection error", { error });
      drop(client);
    });
    client.on("end", () => drop(client));
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    state.client = client;
    if (state.hasConnectedBefore) dispatch({ type: "resync" });
    state.hasConnectedBefore = true;
  } catch (error) {
    logger.error("Realtime LISTEN connection failed", { error });
    client.removeAllListeners();
    client.end().catch(() => {});
    scheduleRetry();
  } finally {
    state.connecting = false;
  }
}

export function subscribeRequestChanged(listener: Listener): () => void {
  state.listeners.add(listener);
  void connect();
  return () => {
    state.listeners.delete(listener);
  };
}
