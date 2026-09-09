"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A numeric preference kept in this browser, read in an SSR-safe way.
 *
 * The naive version — `useState(default)` plus an effect that reads
 * localStorage and calls setState — renders the default first and the stored
 * value a tick later, so the control visibly jumps on every load. It also trips
 * `react-hooks/set-state-in-effect`, which exists to catch exactly that.
 *
 * The lazy-initialiser version is worse: it reads localStorage during the first
 * client render, the server rendered something else, and React hydrates a
 * mismatch.
 *
 * `useSyncExternalStore` is the API for this. It takes a server snapshot and a
 * client snapshot separately, so the server and the first client render agree
 * on the default and the real value arrives without a wasted render. It also
 * gives cross-tab sync for free: change your blend length on one tab and the
 * other updates, because both subscribe to the same store.
 */

/** Same-tab writes don't fire `storage`, so we raise our own event too. */
const CHANGE_EVENT = "gemtopia:preference";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useLocalNumber(
  key: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): [number, (value: number) => void] {
  const getSnapshot = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const value = Number(raw);
      // A stored value outside the accepted range is treated as absent rather
      // than clamped: it means the range changed under it, and the current
      // default is a better answer than the nearest legal edge.
      if (!Number.isFinite(value) || value < min || value > max) return fallback;
      return value;
    } catch {
      // Private mode, or the browser is set to block site data.
      return fallback;
    }
  }, [key, fallback, min, max]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not worth surfacing: the setting still applies to this page, it
        // just won't be remembered next time.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, set];
}
