import type {
  ItemRequest,
  ReimbursementRequest,
  ServiceRequest,
  UrgentRequest,
} from "@shared/types";

type ChangedAction = "created" | "updated" | "deleted";
type RequestType = "item" | "service" | "urgent" | "reimbursement";

export type RequestChangedPayload =
  | { type: "item"; action: ChangedAction; id: number; department?: string | null; data?: ItemRequest }
  | { type: "service"; action: ChangedAction; id: number; department?: string | null; data?: ServiceRequest }
  | { type: "urgent"; action: ChangedAction; id: number; department?: string | null; data?: UrgentRequest }
  | { type: "reimbursement"; action: ChangedAction; id: number; department?: string | null; data?: ReimbursementRequest }
  | { type: RequestType; action: "deleted"; id: number; department?: string | null; data?: undefined };

const listeners = new Set<(payload: RequestChangedPayload) => void>();

export const subscribeRequestChanged = (
  cb: (payload: RequestChangedPayload) => void
): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
