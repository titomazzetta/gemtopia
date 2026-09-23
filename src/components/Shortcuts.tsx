"use client";

import { useEffect, useRef } from "react";

/**
 * The keyboard shortcuts, written down.
 *
 * They all existed already — T for tap tempo among them — and nobody found T,
 * because nothing on screen said it was there. A shortcut you cannot discover
 * is a shortcut for the person who wrote it. So this lists them, opens on `?`
 * (the convention from Gmail, GitHub and most tools people already use), and
 * has a visible button in the header for anyone who would never think to
 * press `?`.
 *
 * The list is the source of truth for the handler in CrateApp only by
 * discipline — if you add a key there, add it here.
 */
export const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ["Space"], action: "Play / pause" },
  { keys: ["T"], action: "Tap tempo — tap along with the beat" },
  { keys: ["←", "→"], action: "Previous / next track" },
  { keys: ["J", "L"], action: "Back / forward 10 seconds" },
  { keys: ["S"], action: "Shuffle what's showing" },
  { keys: ["R"], action: "Repeat on / off" },
  { keys: ["D"], action: "Dig from this track — the whole record, and what it connects to" },
  { keys: ["B"], action: "Back to shuffle, after exploring a record" },
  { keys: ["A"], action: "Add to a playlist" },
  { keys: ["/"], action: "Search the crate" },
  { keys: ["?"], action: "This list" },
  { keys: ["Esc"], action: "Close" },
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves into the sheet so Esc and Tab behave, and the page behind it
  // cannot be operated by keyboard while it is open.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="w-full max-w-sm rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-neutral-100">
            Keyboard
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-100"
          >
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-[12px]">
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={action} className="contents">
              <dt className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="min-w-[1.6rem] rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-center font-mono text-[11px] text-neutral-200"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-neutral-400">{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
