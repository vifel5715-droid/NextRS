"use client";

import { useCallback } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";

export function useNavigate() {
  const router = useRouter();

  return useCallback(
    (destination: string | number) => {
      if (typeof destination === "number") {
        if (destination < 0) router.back();
        else router.forward();
        return;
      }
      // Page segments are empty (the client shell renders every screen), so
      // Next's scroll-to-segment has nothing to target; the shell restores
      // each page's own scroll position instead.
      router.push(destination, { scroll: false });
    },
    [router]
  );
}

export function useLocation() {
  const pathname = usePathname();
  const searchParams = useNextSearchParams();
  const search = searchParams.size ? `?${searchParams.toString()}` : "";

  return { pathname, search, state: null, key: pathname };
}

export function useSearchParams() {
  return [useNextSearchParams()];
}
