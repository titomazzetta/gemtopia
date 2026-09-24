"use client";

import {
  PLAYLIST_VIEWS,
  VIEW_LABELS,
  describeView,
  directionArrow,
  type PlaylistView,
  type PlaylistViewState,
} from "@/client/playlistView";

/**
 * One row of chips above an open playlist: Your order · Artist · Genre · BPM ·
 * Year.
 *
 * Kept to a single quiet row on purpose. The playlist is where a set gets
 * programmed by feel, so the hand-built order is the first chip, the default,
 * and the only view where the transition checks and dragging appear. The
 * other chips are for finding things; they never rewrite anything unless you
 * press "Keep this order", and that keeps one step of undo.
 *
 * On a phone the row scrolls sideways rather than wrapping, so it never costs
 * more than one line of the list.
 */
export function PlaylistViewBar({
  state,
  onChange,
  onKeep,
  onUndo,
  undoLabel,
  busy = false,
}: {
  state: PlaylistViewState;
  onChange: (view: PlaylistView) => void;
  /** Make the current view the stored order. Only offered while a view is on. */
  onKeep: () => void;
  /** Put back the order from before the last Keep / Smooth order. */
  onUndo?: () => void;
  undoLabel?: string;
  busy?: boolean;
}) {
  const viewing = state.view !== "yours";

  return (
    <div className="border-b border-ink-800 bg-ink-900/60 px-3 py-1.5">
      <div
        role="radiogroup"
        aria-label="Show this playlist by"
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {PLAYLIST_VIEWS.map((view) => {
          const active = state.view === view;
          const arrow = active ? directionArrow(state) : "";
          return (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(view)}
              title={
                view === "yours"
                  ? "The order you built. Transitions and dragging live here."
                  : active
                    ? `Tap again to reverse`
                    : `Show by ${VIEW_LABELS[view].toLowerCase()} — your order is kept`
              }
              className={`flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] transition-colors sm:h-7 ${
                active
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-ink-700 text-neutral-400 hover:border-ink-600 hover:text-neutral-200"
              } ${view === "yours" ? "font-semibold" : ""}`}
            >
              {VIEW_LABELS[view]}
              {arrow && <span aria-hidden="true">{arrow}</span>}
            </button>
          );
        })}

        {!viewing && onUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="ml-auto h-9 shrink-0 px-2 text-[11px] text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200 disabled:opacity-40 sm:h-7"
          >
            {undoLabel ?? "Undo reorder"}
          </button>
        )}
      </div>

      {viewing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-neutral-500" aria-live="polite">
            {describeView(state)} Transitions show in your order.
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => onChange("yours")}
              className="text-neutral-300 hover:text-accent"
            >
              Back to your order
            </button>
            <button
              type="button"
              onClick={onKeep}
              disabled={busy}
              title="Replace your order with this one. You can undo it."
              className="text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200 disabled:opacity-40"
            >
              Keep this order
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
