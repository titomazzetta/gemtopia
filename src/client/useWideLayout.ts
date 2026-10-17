"use client";

import { useSyncExternalStore } from "react";

/**
 * True when the desktop layout is showing: Tailwind's `lg`, 1024px and up.
 *
 * For the few places where *what renders* differs, not just how it looks —
 * Discogs search takes the middle column on a desktop and a sheet on a phone,
 * so the crate list under it is only replaced on a desktop. Server render and
 * first paint say "not wide", which is the layout that never hides the list.
 */
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
