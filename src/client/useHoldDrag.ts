"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Press and hold a row to pick it up, move it with the finger, let go to
 * drop it — the phone's way of reordering a list, shared by the whole-list
 * panel and the main track list so a record moves the same way in both.
 *
 * Touch events rather than pointer events, on purpose: once iOS decides a
 * touch is a scroll it cancels pointer events, and the only way to keep a
 * finger that is *holding a record* from scrolling the list is a non-passive
 * touchmove that calls preventDefault. So: a touch that moves before the hold
 * is up is a scroll and is left alone; one that holds still becomes a drag,
 * and from then on its moves are ours. Near the top or bottom edge the list
 * scrolls, so a record can travel further than one screen.
 *
 * The finger lifting off also "clicks" whatever is under it; the first click
 * after a drag is swallowed at the list, so a drop never plays, ticks, adds or
 * removes anything. If no click follows, the guard lapses on its own so the
 * next real tap still works.
 */
export const HOLD_MS = 350;
/** Movement before the hold is up that means "this is a scroll". */
const SLOP_PX = 10;
const EDGE_PX = 48;
const EDGE_STEP = 12;

export function useHoldDrag(
  list: RefObject<HTMLElement | null>,
  options: {
    /**
     * Whether rows may be picked up right now. Must be false while the list
     * element is not rendered (an empty list), so that it turning true after
     * the element mounts attaches the listeners to it.
     */
    enabled: boolean;
    /** The row a touch started on, or null for a touch that must not pick one up. */
    rowAt: (target: HTMLElement) => number | null;
    onPick: (index: number, clientY: number) => void;
    onMove: (clientY: number) => void;
    onDrop: (clientY: number) => void;
    onCancel: () => void;
  },
): void {
  const { enabled } = options;
  // The handlers change every render; the listeners are attached once.
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });

  useEffect(() => {
    const element = list.current;
    if (!element || !enabled) return;
    let timer: number | null = null;
    let start: { x: number; y: number; index: number } | null = null;
    let active = false;
    let lastY = 0;
    let swallowUntil = 0;

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const target = event.target as HTMLElement | null;
      if (!touch || event.touches.length > 1 || !target) return;
      const index = handlers.current.rowAt(target);
      if (index === null) return;
      start = { x: touch.clientX, y: touch.clientY, index };
      lastY = touch.clientY;
      clear();
      timer = window.setTimeout(() => {
        if (!start) return;
        active = true;
        handlers.current.onPick(start.index, lastY);
        navigator.vibrate?.(12);
      }, HOLD_MS);
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !start) return;
      lastY = touch.clientY;
      if (!active) {
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP_PX) {
          clear(); // it's a scroll
          start = null;
        }
        return;
      }
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (touch.clientY < box.top + EDGE_PX) element.scrollTop -= EDGE_STEP;
      else if (touch.clientY > box.bottom - EDGE_PX) element.scrollTop += EDGE_STEP;
      handlers.current.onMove(touch.clientY);
    };

    const onEnd = () => {
      clear();
      start = null;
      if (active) {
        active = false;
        swallowUntil = Date.now() + 400;
        handlers.current.onDrop(lastY);
      }
    };

    const onCancel = () => {
      clear();
      start = null;
      if (active) {
        active = false;
        handlers.current.onCancel();
      }
    };

    const onClick = (event: MouseEvent) => {
      if (Date.now() > swallowUntil) return;
      swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    element.addEventListener("click", onClick, true);
    return () => {
      clear();
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
      element.removeEventListener("click", onClick, true);
    };
  }, [list, enabled]);
}
