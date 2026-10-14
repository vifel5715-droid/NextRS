"use client";

import { useEffect } from "react";

// Set by Next.js on a Server Action response when the action ID the client
// sent doesn't exist in the running build (see next's app-router-headers).
const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";
const LAST_RELOAD_KEY = "stale-deployment-reload-at";
// Upper bound on reload frequency, so a rolling deploy where an old instance
// is still answering can't trap the tab in a reload loop.
const MIN_RELOAD_INTERVAL_MS = 60_000;

function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) ?? 0);
    if (Date.now() - last < MIN_RELOAD_INTERVAL_MS) return;
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // storage unavailable — reload anyway; the new build won't hit this again
  }
  window.location.reload();
}

/**
 * A tab left open across a deploy keeps the previous build's JS, so every
 * Server Action it calls (including the 30s sidebar-count polls) carries an
 * action ID the new server no longer has. Next.js rejects each one and logs
 * "Failed to find Server Action", while the callers' catch blocks swallow
 * the failure, leaving the tab silently broken. Reloading picks up the
 * current build.
 */
export function StaleDeploymentReload() {
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.headers.get(ACTION_NOT_FOUND_HEADER)) reloadOnce();
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
