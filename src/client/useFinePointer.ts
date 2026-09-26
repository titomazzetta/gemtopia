"use client";

import { useSyncExternalStore } from "react";

/**
 * True on a mouse or trackpad, false on a touchscreen.
 *
 * Drag-to-playlist is a desktop gesture. On a phone, a long press on a
 * draggable row starts a drag preview instead of doing what the thumb meant,
 * so rows are only draggable where the pointer is fine. Server render and
 * first paint assume touch — the conservative answer — and correct on mount.
 */
const QUERY = "(pointer: fine)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
