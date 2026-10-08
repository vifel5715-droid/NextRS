import { io, type Socket } from "socket.io-client";
import { createLogger } from "@shared/utils/logger";
import type { ItemRequest, ServiceRequest, UrgentRequest, ReimbursementRequest } from "@shared/types";

const log = createLogger("socket");

const SOCKET_URL = "";

/**
 * `data` carries the changed row already projected into list shape (see
 * server lib/socket.ts) so a "created"/"updated" event can be patched
 * straight into local list state — no follow-up fetch needed. It's absent
 * for "deleted" (nothing to project) and for changes that don't touch any
 * list-visible field (e.g. an attachment replacement), in which case
 * consumers should leave their list state alone.
 */
export type RequestChangedPayload =
  | { type: "item"; action: "created" | "updated"; id: number; department?: string | null; data?: ItemRequest }
  | { type: "service"; action: "created" | "updated"; id: number; department?: string | null; data?: ServiceRequest }
  | { type: "urgent"; action: "created" | "updated"; id: number; department?: string | null; data?: UrgentRequest }
  | { type: "reimbursement"; action: "created" | "updated"; id: number; department?: string | null; data?: ReimbursementRequest }
  | { type: "item" | "service" | "urgent" | "reimbursement"; action: "deleted"; id: number; department?: string | null; data?: undefined };

let socket: Socket | null = null;

// ARCH: components subscribe here instead of touching `socket` directly.
// This set exists from module load, independent of connection state or
// React effect ordering (child effects run before parent effects, so a
// dashboard's listener can easily mount before the app-level connect
// effect does) — subscribing never races against the socket being created.
const listeners = new Set<(payload: RequestChangedPayload) => void>();

export const subscribeRequestChanged = (cb: (payload: RequestChangedPayload) => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/**
 * The handshake carries no credential of its own: `withCredentials` sends the
 * httpOnly auth cookie, and the server reads the JWT from it. An already-open
 * connection is therefore always the right one — there is no token identity
 * to compare against, as the previous `socket.auth.token` check did.
 */
export const connectSocket = (): Socket => {
  if (socket?.connected) {
    return socket;
  }
  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => log.info("Connected"));
  socket.on("disconnect", (reason) => log.info("Disconnected:", reason));
  socket.on("connect_error", (err) => log.warn("Connection error:", err.message));
  socket.on("request:changed", (payload: RequestChangedPayload) => {
    listeners.forEach((cb) => cb(payload));
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
