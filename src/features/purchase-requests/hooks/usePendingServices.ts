import { useState, useEffect, useCallback, useRef } from "react";
import type { PendingService } from "@/lib/api";
import { getPendingServicesAction } from "@/features/purchase-requests/actions/pending-services";
import { useRequestsChanged } from "@/hooks/useRequestsChanged";
import { debounce } from "@/lib/utils/debounce";

// Mirrors usePendingItems.ts, for the service side of the same "awaiting
// Purchase Request or Payment Request" sidebar badge. Polling stays as a
// fallback in case a socket event is missed; realtime updates via
// useRequestsChanged handle the common case.
const POLL_INTERVAL_MS = 30_000;

export const usePendingServices = (role: string | undefined, isAuthenticated = true) => {
  const [services, setServices] = useState<PendingService[]>([]);

  const targetRoles = ["staff", "secretary", "supervisor", "manager", "custodian"];
  const active = isAuthenticated && role ? targetRoles.includes(role.toLowerCase()) : false;

  const fetchServices = useCallback(async () => {
    if (!active) return;
    try {
      setServices(await getPendingServicesAction());
    } catch {
      // silently ignore — sidebar badge is non-critical
    }
  }, [active]);

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      if (!active) return;
      try {
        const pendingServices = await getPendingServicesAction();
        if (!cancelled) {
          setServices(pendingServices);
        }
      } catch {
        // silently ignore — sidebar badge is non-critical
      }
    };

    void runFetch();
    if (!active) return () => {
      cancelled = true;
    };
    const id = setInterval(() => {
      void runFetch();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  const debouncedFetch = useRef(debounce(fetchServices, 400));
  useEffect(() => {
    debouncedFetch.current = debounce(fetchServices, 400);
  }, [fetchServices]);

  const handleChange = useCallback((payload: { type: "item" | "service" | "urgent" | "reimbursement" }) => {
    if (payload.type === "service") debouncedFetch.current();
  }, []);
  useRequestsChanged(handleChange);

  return services;
};
