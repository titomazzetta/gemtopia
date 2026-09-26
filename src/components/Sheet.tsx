"use client";

import { useEffect, useRef } from "react";

/**
 * A bottom sheet. Phones only.
 *
 * The mobile layout used to stack everything — filter panel, then list, then
 * player — so the list, the one thing you are actually looking at, sat in the
 * middle of a column you had to scroll past a wall of facets to reach. The fix
 * is not smaller facets. It is that a phone should show one thing at a time,
 * and everything else arrives over the top when asked for and leaves when
 * dismissed.
 *
 * Sheets rather than full-screen modals because a sheet keeps the thing behind
 * it partly visible, which is what tells you it is temporary. And they open
 * from the bottom, where the thumb is.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  aboveBar = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Pinned below the scroll area — for a "clear all" or a primary action. */
  footer?: React.ReactNode;
  /**
   * Stop above the player bar instead of covering it, so the transport stays
   * usable while the sheet is open. The bar publishes its height as
   * `--mobile-bar-h` (MobileBar.tsx); without it this falls back to 0.
   */
  aboveBar?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes. Cheap, and the one keyboard affordance that matters even on
  // a phone, because tablets and phones with keyboards exist.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  /*
   * Stop the page behind from scrolling while a sheet is open. Without this,
   * flicking inside the sheet scrolls the track list underneath and you lose
   * your place in a 1,500-record crate — which is a genuinely infuriating way
   * to lose your place.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the sheet so a screen reader lands in the right place.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex flex-col justify-end lg:hidden"
      style={{ bottom: aboveBar ? "var(--mobile-bar-h, 0px)" : 0 }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex flex-col rounded-t-2xl border-t border-ink-700 bg-ink-900 outline-none ${
          aboveBar ? "max-h-[calc(85vh_-_var(--mobile-bar-h,0px))] border-b" : "max-h-[85vh]"
        }`}
      >
        {/* The grab handle. Purely a signal that this thing dismisses. */}
        <div className="flex shrink-0 justify-center pt-2.5" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-ink-600" />
        </div>

        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:bg-ink-800 hover:text-neutral-200"
          >
            Done
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-ink-800 px-4 py-3">
            {footer}
          </div>
        )}

        {/*
          Home-indicator clearance on iPhones. Without it the last row of a
          sheet sits under the gesture bar and cannot be tapped.
        */}
        {!aboveBar && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </div>
    </div>
  );
}
