"use client";

import { useEffect, useRef, useState } from "react";
import { normaliseTag } from "@/lib/tags";
import { Plus, SelectIcon, TagIcon, Trash } from "./Icons";

/**
 * What a selection can do, at the foot of the list.
 *
 * It sits under the rows rather than over them, above the phone's player bar,
 * so it never hides a track you might want to tick next. One line where
 * there's room; on a phone the actions take a second. The count comes first
 * and says when some of what's ticked is out of sight behind a filter, so
 * "Add 40" never surprises anyone looking at five.
 */
export function SelectionBar({
  count,
  hidden,
  shownTotal,
  allShownTicked,
  target,
  onAdd,
  onAddOther,
  suggestions,
  tagsReady,
  onTag,
  removal,
  onRemove,
  onSelectAll,
  onClear,
}: {
  /** Ticked tracks. */
  count: number;
  /** Of those, how many a filter or search is hiding right now. */
  hidden: number;
  /** Tracks on screen. */
  shownTotal: number;
  allShownTicked: boolean;
  /** The set one tap adds to; null and the main button asks which. */
  target: { name: string } | null;
  onAdd: () => void;
  onAddOther: () => void;
  /** Your tags, most used first, for one-tap tagging. */
  suggestions: readonly string[];
  tagsReady: boolean;
  onTag: (tag: string) => void;
  /** In a playlist: how many ticked rows are yours to take out, and how many aren't. */
  removal?: { allowed: number; refused: number };
  onRemove?: () => void;
  onSelectAll: () => void;
  /** Untick everything and leave select mode. */
  onClear: () => void;
}) {
  const [tagging, setTagging] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * Publish this bar's height, so toasts sit above it instead of on top of
   * it — the same trick as the phone's player bar (--mobile-bar-h).
   */
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = barRef.current;
    if (!element) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        root.style.setProperty(
          "--selection-bar-h",
          `${Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)}px`,
        );
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--selection-bar-h");
    };
  }, []);

  useEffect(() => {
    if (tagging) inputRef.current?.focus();
  }, [tagging]);

  const tagNow = (raw: string) => {
    const one = normaliseTag(raw);
    if (!one.ok) return;
    onTag(one.tag);
    setDraft("");
    setTagging(false);
  };
  const draftOk = normaliseTag(draft).ok;

  const chip =
    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-ink-700 px-3 py-1.5 text-[11px] font-medium text-neutral-200 hover:border-accent/50 hover:text-accent disabled:opacity-40";

  return (
    <div
      ref={barRef}
      role="region"
      aria-label={`${count} selected`}
      className="shrink-0 border-t border-accent/30 bg-ink-900 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection"
          title="Clear the selection (Esc)"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink-700 text-base leading-none text-neutral-400 hover:text-neutral-100"
        >
          ×
        </button>
        <p className="min-w-0 shrink text-xs text-neutral-300" aria-live="polite">
          {count === 0 ? (
            <span className="text-neutral-500">Tick the tracks you want</span>
          ) : (
            <>
              <span className="font-semibold text-accent">{count.toLocaleString()}</span> selected
            </>
          )}
          {hidden > 0 && (
            <span className="text-neutral-500" title="Ticked earlier, and hidden now by a search or filter">
              {" "}
              · {hidden.toLocaleString()} not shown
            </span>
          )}
        </p>
        {!allShownTicked && shownTotal > 0 && (
          <button
            type="button"
            onClick={onSelectAll}
            className="shrink-0 whitespace-nowrap text-[11px] text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
          >
            <SelectIcon className="mr-1 inline h-3 w-3 -translate-y-px" />
            All {shownTotal.toLocaleString()}
          </button>
        )}

        {!tagging && count > 0 && (
          <>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTagging(true)}
                disabled={!tagsReady}
                title={tagsReady ? "Add one of your tags to every ticked track" : "Your tags are still loading"}
                className={chip}
              >
                <TagIcon className="h-3 w-3" />
                Tag
              </button>
              {removal && onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  title={
                    removal.refused > 0
                      ? `${removal.refused} of these were added by others — not yours to take out`
                      : "Take the ticked tracks out of this playlist"
                  }
                  className={`${chip} hover:border-red-400/50 hover:text-red-300`}
                >
                  <Trash className="h-3 w-3" />
                  {removal.allowed > 0 ? `Remove ${removal.allowed.toLocaleString()}` : "Remove"}
                  {removal.refused > 0 && (
                    <span className="font-normal text-neutral-500">· {removal.refused} not yours</span>
                  )}
                </button>
              )}
            </div>
            {/*
              The main move gets a line of its own on a phone, thumb-wide;
              where there's room it joins the others on one line.
            */}
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
              <button
                type="button"
                onClick={target ? onAdd : onAddOther}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-2 text-[11px] font-semibold text-ink-950 sm:flex-none sm:py-1.5"
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span className="truncate">{target ? `Add to ${target.name}` : "Add to…"}</span>
              </button>
              {target && (
                <button type="button" onClick={onAddOther} className={chip}>
                  Other…
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {tagging && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            tagNow(draft);
          }}
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (draft) setDraft("");
                else setTagging(false);
              }
            }}
            maxLength={64}
            enterKeyHint="done"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={`Tag ${count.toLocaleString()} ${count === 1 ? "track" : "tracks"}…`}
            aria-label={`A tag for the ${count} ticked tracks`}
            className="min-w-0 flex-1 basis-40 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs placeholder:text-neutral-600"
          />
          <button
            type="submit"
            disabled={!draftOk}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink-950 disabled:opacity-40"
          >
            Tag
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setTagging(false);
            }}
            className="shrink-0 px-2 py-1.5 text-[11px] text-neutral-500 hover:text-neutral-200"
          >
            Cancel
          </button>
          {suggestions.length > 0 && (
            <div className="flex w-full flex-wrap gap-1.5" aria-label="Your tags">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => tagNow(tag)}
                  className="rounded-full border border-accent/30 px-2.5 py-1 text-[11px] text-accent/90 hover:bg-accent/10"
                >
                  + {tag}
                </button>
              ))}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
