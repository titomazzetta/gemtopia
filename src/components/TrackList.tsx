"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Playable } from "@/lib/types";
import { STRAIN_META, transitionWords, type MixCheck } from "@/lib/mixing";
import { formatTime } from "./NowPlaying";
import { formatBpm } from "@/lib/mixing";
import { Disc, Lock, NoPreview, Play, Plus, Trash } from "./Icons";
import { ShareButton } from "./ShareButton";
import type { SortKey, SortState } from "@/client/sorting";
import {
  isRowDrag,
  readClipDrag,
  readRowDrag,
  writeClipDrag,
  writeClipsDrag,
  writeRowDrag,
} from "@/client/clipDrag";
import { isNoopBlockMove, NO_SELECTION, type Selection } from "@/client/selection";
import { slotInRows, slotToIndex } from "@/client/pullList";
import { useFinePointer } from "@/client/useFinePointer";
import { useHoldDrag } from "@/client/useHoldDrag";

const BASE_ROW_HEIGHT = 56;

/**
 * How long ago a record entered the collection, in twelve pixels.
 *
 * A date does not fit and would not help: scanning for new arrivals is a
 * question about recency, not about the 4th of March. Blank rather than a
 * dash when Discogs gave us no date, because the column is already quiet and
 * a row of dashes reads as an error.
 */
function formatAdded(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
/** Extra height for the transition strip when set-prep mode is on. */
const TRANSITION_HEIGHT = 22;
const OVERSCAN = 8;

const TONE_CLASS: Record<string, string> = {
  good: "text-accent/80 border-accent/25 bg-accent/5",
  shift: "text-sky-300/90 border-sky-400/25 bg-sky-400/5",
  warn: "text-amber-300/90 border-amber-400/30 bg-amber-400/5",
  bad: "text-red-300/90 border-red-400/30 bg-red-400/5",
  muted: "text-neutral-600 border-ink-800 bg-transparent",
};

/**
 * The strip between two records in a playlist.
 *
 * Reads as one line a DJ can scan while packing a bag: can these two be
 * beatmatched, at what tempo, and how far each fader has to move. When they
 * cannot, it says what pitch range *would* have worked — that is the number
 * that tells you whether to swap the record or swap the deck.
 */
export function TransitionStrip({ check }: { check: MixCheck }) {
  /*
   * Nothing to judge yet: one of the two has no BPM. A dashed hairline, not
   * "No BPM · BPM not catalogued" on every pair — six identical grey lines
   * on a seven-track set said nothing the row's own dash didn't, and buried
   * the one strip that could speak. The set-prep bar says how many are
   * missing, once.
   */
  if (check.strain === "unknown") {
    return (
      <div
        className="flex h-[22px] items-center px-3"
        title="No BPM on one of these yet, so the blend can't be judged — play it through, or tap T"
      >
        <span aria-hidden="true" className="w-full border-t border-dashed border-ink-800" />
        <span className="sr-only">No BPM on one of these yet</span>
      </div>
    );
  }
  // Colour answers "is this comfortable", which is what you scan for; the
  // verdict says how the records meet. A double-time blend that needs ±1% is
  // green, and a straight 1:1 at ±7% each is amber.
  //
  // The tier is also said in words, and before the summary, never after it.
  // It used to ride as a suffix on the summary, which `truncate` cuts from the
  // end — so on a phone the one word separating green from amber was the
  // first thing to go, leaving a colour-blind DJ two identical rows.
  const tone = STRAIN_META[check.strain].tone;
  const words = transitionWords(check);
  return (
    <div
      className={`flex h-[22px] items-center gap-1.5 border-l-2 px-3 text-[10px] ${TONE_CLASS[tone]}`}
      title={check.summary}
    >
      <span className="font-mono opacity-70">↳</span>
      <span className="shrink-0 font-medium">{words.verdict}</span>
      {words.tier && (
        <span className="shrink-0 font-semibold">· {words.tier}</span>
      )}
      <span className="truncate opacity-80">{check.summary}</span>
    </div>
  );
}

/**
 * Your tags on a row: the first one, and how many more. "#deep +2" on
 * screen, "tagged deep and 2 more" read aloud; every tag in the tooltip.
 */
function TagMark({ tags, className = "" }: { tags: readonly string[]; className?: string }) {
  const more = tags.length - 1;
  return (
    <span
      className={`min-w-0 shrink-0 truncate text-accent/80 ${className}`}
      title={tags.map((tag) => `#${tag}`).join("  ")}
    >
      <span className="sr-only">, tagged </span>
      <span aria-hidden="true">#</span>
      {tags[0]}
      {more > 0 && (
        <>
          <span aria-hidden="true" className="text-accent/50"> +{more}</span>
          <span className="sr-only"> and {more} more</span>
        </>
      )}
    </span>
  );
}

/**
 * A clickable column heading.
 *
 * The arrow shows the direction only for the active column. Showing a faint
 * arrow on every sortable column — a common pattern — makes the active one
 * harder to spot, which is the one thing the row has to communicate.
 */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null | undefined;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      /*
       * The state goes in the label rather than aria-sort, because aria-sort
       * belongs on a columnheader and this is not a table — it is a virtualised
       * list, and scattering table roles across it would describe a structure
       * that is not there. A label that says what the control currently does is
       * both accurate and more useful read aloud.
       */
      aria-label={
        active
          ? `Sort by ${label}, currently ${sort?.direction === "asc" ? "ascending" : "descending"}`
          : `Sort by ${label}`
      }
      className={`flex items-center gap-0.5 text-[10px] uppercase tracking-wider transition-colors ${
        active ? "text-accent" : "text-neutral-600 hover:text-neutral-300"
      } ${className}`}
    >
      {label}
      {active && (
        <span aria-hidden="true" className="text-[8px]">
          {sort?.direction === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

/**
 * The box at the left of a row (and of the header) for ticking tracks.
 *
 * A real button with role="checkbox", so it is reached by keyboard and read
 * as ticked or not. 24px square around a 16px box: big enough to hit with a
 * mouse without nudging the columns. `quiet` keeps it invisible until the row
 * is hovered or the box focused, for the moments nothing is ticked yet.
 */
function CheckBox({
  checked,
  mixed = false,
  label,
  onClick,
  quiet,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  quiet: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-sm transition-opacity focus-visible:opacity-100 ${
        quiet ? "opacity-0 group-hover:opacity-100 hover:opacity-100" : ""
      }`}
    >
      <span
        className={`grid h-4 w-4 place-items-center rounded-[3px] border ${
          checked || mixed ? "border-accent bg-accent text-ink-950" : "border-neutral-600 bg-ink-950/40"
        }`}
      >
        {checked ? (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        ) : mixed ? (
          <span className="h-0.5 w-2 rounded-full bg-ink-950" aria-hidden="true" />
        ) : null}
      </span>
    </button>
  );
}

/**
 * Windowed list.
 *
 * A 1,500-record crate produces a few thousand clips. Rendering that many DOM
 * rows makes filtering feel sticky on a laptop, so we render only the visible
 * slice — ~30 rows — and translate the viewport. Fixed row height keeps this
 * to about forty lines instead of pulling in a virtualisation library.
 */
export function TrackList({
  items,
  currentKey,
  onPlay,
  onAdd,
  addLabel = "Add to playlist",
  onRemove,
  canRemove,
  markRecordOnly = true,
  addedBy,
  phoneMeta = false,
  emptyMessage,
  emptyAction,
  reorderable = false,
  onReorder,
  transitions,
  sort,
  onSort,
  selected = NO_SELECTION,
  selecting = false,
  onSelect,
  onSelectAll,
  dragKeys,
  onMoveBlock,
  onRemoveRefused,
}: {
  items: Playable[];
  currentKey: string | null;
  onPlay: (index: number) => void;
  /** Your current set in one tap; `choose` (Shift-click) opens the picker. */
  onAdd?: (item: Playable, choose?: boolean) => void;
  /** "Add to B2B at the Lot", for the + buttons' labels. */
  addLabel?: string;
  onRemove?: (item: Playable, index: number) => void;
  /**
   * The "record only" tag beside a track's title. On in a playlist, where
   * "will it play?" is the question; off in the crate, where a vinyl
   * collection is mostly record-only and the disc on the artwork says it.
   */
  markRecordOnly?: boolean;
  /**
   * Whether this row may be removed. Omitted means all of them. On a shared
   * playlist a collaborator can only take out records they added.
   */
  canRemove?: (item: Playable, index: number) => boolean;
  /**
   * On a shared playlist: who put this record in ("you" for yourself), shown
   * as a small amber tag on the row.
   */
  addedBy?: (item: Playable, index: number) => string | null;
  /**
   * On a phone the year / BPM / length columns don't fit; with this, the
   * second line carries them instead of the release title.
   */
  phoneMeta?: boolean;
  emptyMessage: string;
  /**
   * Offered beneath the empty message. An empty crate is the one moment the
   * app knows exactly what you were looking for and cannot give it to you,
   * which makes it the right place to offer the next move rather than a full
   * stop.
   */
  emptyAction?: ReactNode;
  reorderable?: boolean;
  onReorder?: (from: number, to: number) => void;
  /** Mix check for the transition *into* each index. Index 0 has none. */
  transitions?: Map<number, MixCheck>;
  /** Current column sort, or null for the list's own order. */
  sort?: SortState | null;
  /** Omitted where sorting makes no sense — a playlist has a real order. */
  onSort?: (key: SortKey) => void;
  /** Ticked tracks, by key (client/selection.ts). */
  selected?: Selection;
  /**
   * Select mode: every row shows its box, and a plain click or tap ticks it
   * instead of playing it. The phone's way in (its Select button); with a
   * mouse the boxes show on hover and Cmd/Ctrl- and Shift-click tick.
   */
  selecting?: boolean;
  /** Tick or untick one row, or tick the run from the last one ticked. Omitted: no boxes. */
  onSelect?: (index: number, how: "toggle" | "range") => void;
  /** The header's box: tick everything shown, or clear. Only where there's a header. */
  onSelectAll?: (all: boolean) => void;
  /**
   * The keys a drag of this row should carry. More than one when the row is
   * part of a selection: the whole selection then drops onto a playlist.
   */
  dragKeys?: (key: string) => readonly string[];
  /** Move ticked rows together, as one block, to a gap (selection.moveBlock). */
  onMoveBlock?: (indices: number[], slot: number) => void;
  /** A row that isn't yours to take out was tapped where its trash would be. */
  onRemoveRefused?: (item: Playable, index: number) => void;
}) {
  /*
   * Strips appear once there is something to say. A set with no BPMs at all
   * is tight rows and a count in the set-prep bar; the first tapped tempo
   * opens the strips up (hairlines for the pairs still unjudged).
   */
  const judged = useMemo(() => {
    let n = 0;
    for (const check of transitions?.values() ?? []) if (check.strain !== "unknown") n += 1;
    return n;
  }, [transitions]);
  const showTransitions = judged > 0;
  const ROW_HEIGHT = showTransitions
    ? BASE_ROW_HEIGHT + TRANSITION_HEIGHT
    : BASE_ROW_HEIGHT;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  /*
   * The list's own width, not the window's. On a laptop-sized window the
   * crate sits between the filter rail and the player, and at 800–1100px
   * wide that left the title a few letters once the style, year and added
   * columns had their room. Below this, those three step aside so the
   * title and artist can be read; BPM and length stay.
   */
  const [width, setWidth] = useState(1000);
  const tight = width < 720;
  const hasItems = items.length > 0;
  const finePointer = useFinePointer();

  /*
   * Picking several. With a mouse every row keeps a box at its left, shown on
   * hover (and for good once anything is ticked), so the columns never shift
   * when the first one is. On a touch screen the boxes appear only in select
   * mode, where the row's own buttons step aside for the selection bar's.
   */
  const showChecks = Boolean(onSelect) && (finePointer || selecting);
  const checksOn = selecting || selected.size > 0;
  const rowActions = !(selecting && !finePointer);
  /** This list's ticked rows, by index: what moves when one of them is dragged. */
  const selectedIndices = useMemo(() => {
    const out: number[] = [];
    if (selected.size === 0) return out;
    items.forEach((item, index) => {
      if (selected.has(item.key)) out.push(index);
    });
    return out;
  }, [items, selected]);
  const allShownTicked = selectedIndices.length === items.length && items.length > 0;
  /** The rows a drag of row `from` moves: its whole selection, or null for just itself. */
  const blockFor = (from: number): number[] | null =>
    onMoveBlock && selectedIndices.length > 1 && selected.has(items[from]?.key ?? "")
      ? selectedIndices
      : null;

  /*
   * Dragging a row to a new place in the set, with a mouse.
   *
   * The whole-list panel shows a green line where a held record will land;
   * this is the same line for the main list. The pointer sits in a gap
   * between rows — a slot, 0..n, see pullList.slotToIndex — the line is drawn
   * on that gap, and the drop moves the row there. Dropping *on* a row used
   * to mean "take its place", which lands above the row going up and below
   * it coming down, and nothing on screen said which.
   *
   * `dragIndex` says a row of this list is being dragged, and which; the same
   * index travels with the drag (clipDrag.writeRowDrag) because the list is
   * windowed, and a row scrolled out of the window mid-drag is recycled — with
   * its dragend, so the ref alone could be stale by the drop. `drag` is the
   * picture: the row to dim and the slot to mark (null while the pointer is
   * off the list).
   */
  const dragIndex = useRef<number | null>(null);
  /** The held row's track, for a phone drop: the set can change under a long hold. */
  const dragKey = useRef<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; slot: number | null } | null>(null);
  const clearDrag = useCallback(() => {
    dragIndex.current = null;
    dragKey.current = null;
    setDrag(null);
  }, []);

  const slotUnder = (viewport: HTMLDivElement, clientY: number) =>
    slotInRows(
      clientY - viewport.getBoundingClientRect().top + viewport.scrollTop,
      ROW_HEIGHT,
      items.length,
    );

  const onViewportDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!reorderable || dragIndex.current === null || !isRowDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const viewport = event.currentTarget;
    // Near the top or bottom edge, scroll the list so a record can travel
    // further than one screen. Chrome does this on its own; Safari does not.
    const box = viewport.getBoundingClientRect();
    if (event.clientY < box.top + 48) viewport.scrollTop -= 12;
    else if (event.clientY > box.bottom - 48) viewport.scrollTop += 12;
    const from = dragIndex.current;
    const slot = slotUnder(viewport, event.clientY);
    setDrag((current) =>
      current && current.from === from && current.slot === slot ? current : { from, slot },
    );
  };

  const onViewportDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    // Leaving for a child element is not leaving the list. Safari gives no
    // relatedTarget on drag events, so the pointer's position decides there.
    const viewport = event.currentTarget;
    if (viewport.contains(event.relatedTarget as Node | null)) return;
    if (event.relatedTarget === null) {
      const box = viewport.getBoundingClientRect();
      const inside =
        event.clientX >= box.left && event.clientX < box.right &&
        event.clientY >= box.top && event.clientY < box.bottom;
      if (inside) return;
    }
    setDrag((current) => (current && current.slot !== null ? { ...current, slot: null } : current));
  };

  const onViewportDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const started = dragIndex.current;
    clearDrag();
    if (!reorderable || started === null || !onReorder) return;
    let from = readRowDrag(event.dataTransfer);
    if (from === null) return;
    event.preventDefault();
    const key = readClipDrag(event.dataTransfer);
    if (key !== null && items[from]?.key !== key) {
      // The set changed under the drag — a collaborator's edit landing
      // mid-move — so find the row by what it is, not where it was.
      from = items.findIndex((item) => item.key === key);
    }
    if (from < 0 || from >= items.length) return;
    const slot = slotUnder(event.currentTarget, event.clientY);
    const block = blockFor(from);
    if (block) {
      if (!isNoopBlockMove(items.length, block, slot)) onMoveBlock?.(block, slot);
      return;
    }
    const to = slotToIndex(from, slot);
    if (to !== from) onReorder(from, to);
  };

  /*
   * No mouse events fire while a drag is in progress, so the first one after
   * is the drag being over — including the drag whose dragend never arrived
   * because its row had been recycled out of the window. The ref stays: it
   * is the drop's guard, and the next dragstart resets it either way.
   */
  useEffect(() => {
    if (drag === null) return;
    const done = () => setDrag(null);
    window.addEventListener("mousemove", done, { once: true });
    return () => window.removeEventListener("mousemove", done);
  }, [drag]);

  /*
   * On a phone there is no mouse to drag with: press and hold a row to pick it
   * up, as in the whole-list panel, with the same line showing where it will
   * land. The rows are not `draggable` there, so iOS's own long-press drag
   * never competes with the hold.
   */
  const touchReorder = reorderable && !finePointer;
  useHoldDrag(viewportRef, {
    enabled: touchReorder && hasItems,
    rowAt: (target) => {
      const row = target.closest<HTMLElement>("[data-index]");
      return row ? Number(row.dataset.index) : null;
    },
    onPick: (index, clientY) => {
      const viewport = viewportRef.current;
      dragIndex.current = index;
      dragKey.current = items[index]?.key ?? null;
      setDrag({ from: index, slot: viewport ? slotUnder(viewport, clientY) : null });
    },
    onMove: (clientY) => {
      const viewport = viewportRef.current;
      const from = dragIndex.current;
      if (!viewport || from === null) return;
      const slot = slotUnder(viewport, clientY);
      setDrag((current) => (current && current.slot === slot ? current : { from, slot }));
    },
    onDrop: (clientY) => {
      const viewport = viewportRef.current;
      let from = dragIndex.current;
      const key = dragKey.current;
      clearDrag();
      if (!viewport || from === null || !onReorder) return;
      // A collaborator's edit landed during the hold: find the row by what
      // it is, as the mouse drop does, or leave it if it's gone.
      if (key !== null && items[from]?.key !== key) from = items.findIndex((item) => item.key === key);
      if (from < 0) return;
      const slot = slotUnder(viewport, clientY);
      const block = blockFor(from);
      if (block) {
        if (!isNoopBlockMove(items.length, block, slot)) onMoveBlock?.(block, slot);
        return;
      }
      const to = slotToIndex(from, slot);
      if (to !== from) onReorder(from, to);
    },
    onCancel: clearDrag,
  });

  // The gap the line is drawn on. Either gap beside the row itself is no move
  // at all, so nothing is drawn there — the phone's list does the same. For a
  // ticked block, any gap where dropping would change nothing.
  const draggedBlock = drag !== null ? blockFor(drag.from) : null;
  const dropSlot =
    drag === null || drag.slot === null
      ? null
      : draggedBlock
        ? isNoopBlockMove(items.length, draggedBlock, drag.slot)
          ? null
          : drag.slot
        : drag.slot !== drag.from && drag.slot !== drag.from + 1
          ? drag.slot
          : null;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setHeight(entry.contentRect.height);
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
    // Re-attached when the list goes from empty to not: the empty state has
    // no viewport, so an observer set up while empty would watch nothing —
    // and the width (and height) would stay at their defaults for good.
  }, [hasItems]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
  );
  const slice = items.slice(start, end);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-neutral-600">
        <p>{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        The header sits outside the scrolling viewport, not inside it. The list
        is virtualised — only the visible rows exist — so a header row placed
        among them would be recycled away the moment you scrolled.

        It appears only when `onSort` is passed, which is the crate. A playlist
        has a real order that means something, and offering to re-sort the view
        would put the displayed order and the stored order into disagreement —
        with transition checks between rows that are no longer adjacent.
      */}
      {onSort && (
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900/60 px-3 py-1.5">
          {showChecks &&
            (onSelectAll ? (
              <CheckBox
                checked={allShownTicked}
                mixed={!allShownTicked && selectedIndices.length > 0}
                label={allShownTicked ? "Untick everything shown" : `Tick all ${items.length.toLocaleString()} shown`}
                onClick={() => onSelectAll(!allShownTicked)}
                quiet={false}
              />
            ) : (
              <span className="w-6 shrink-0" aria-hidden="true" />
            ))}
          <span className="w-9 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <SortHeader label="Title" sortKey="title" sort={sort} onSort={onSort} />
            <SortHeader label="Artist" sortKey="artist" sort={sort} onSort={onSort} />
            <SortHeader label="Label" sortKey="label" sort={sort} onSort={onSort} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SortHeader
              label="Year"
              sortKey="year"
              sort={sort}
              onSort={onSort}
              className={`hidden w-8 justify-end ${tight ? "" : "sm:flex"}`}
            />
            {/*
              Date added. Hidden on a narrow phone along with Year, because
              seven columns on a 390px screen is none of them — the two
              "newest first" buttons in the source sheet are the phone's route
              to this same ordering.
            */}
            <SortHeader
              label="Added"
              sortKey="added"
              sort={sort}
              onSort={onSort}
              className={`hidden w-12 justify-end ${tight ? "" : "md:flex"}`}
            />
            <SortHeader
              label="BPM"
              sortKey="bpm"
              sort={sort}
              onSort={onSort}
              className="w-11 justify-end"
            />
            <SortHeader
              label="Len"
              sortKey="duration"
              sort={sort}
              onSort={onSort}
              className="w-10 justify-end"
            />
          </div>
          {(onAdd || onRemove) && <span className="w-7 shrink-0" aria-hidden="true" />}
        </div>
      )}

      <div
        ref={viewportRef}
        onScroll={onScroll}
        // The drop target is the whole list, not the row under the pointer,
        // so a record can be dropped below the last row or over the gap
        // between two, and the slot comes from where the pointer is. Enter
        // is handled like over: a target has to accept both, and a fast
        // pointer crossing a row fires only the first.
        onDragEnter={onViewportDragOver}
        onDragOver={onViewportDragOver}
        onDragLeave={onViewportDragLeave}
        onDrop={onViewportDrop}
        className="min-h-0 flex-1 overflow-y-auto"
      >
      <div style={{ height: items.length * ROW_HEIGHT, position: "relative" }}>
        {dropSlot !== null && (
          // Where the dragged row will land: a line on the gap between rows,
          // in the list's full height so it is right whichever rows are
          // rendered. Kept a pixel inside either end so it is never clipped.
          <span
            aria-hidden="true"
            data-drop-line={dropSlot}
            className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent"
            style={{
              top: Math.min(Math.max(0, dropSlot * ROW_HEIGHT - 1), items.length * ROW_HEIGHT - 2),
            }}
          />
        )}
        <ul
          style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
          className="absolute inset-x-0 top-0"
        >
          {slice.map((item, i) => {
            const index = start + i;
            const active = item.key === currentKey;
            const ticked = selected.has(item.key);
            // The rows travelling with a drag: the grabbed one, or its whole selection.
            const travelling = drag !== null && (drag.from === index || (draggedBlock !== null && ticked));
            /*
             * Shown, but visibly not playable. Hiding these was the old
             * behaviour and it meant you could own a record, sync it, and
             * never see it — with nothing on screen admitting that. Dimmed
             * plus an icon plus a title attribute, so the reason survives
             * whether you are scanning, hovering, or using a screen reader.
             */
            const silent = item.silence !== null;
            /*
             * Record only: a real track off the tracklist with no clip. Most of
             * a vinyl crate is like this, so it is not dimmed into the
             * background like a failure — it's a track you play from the
             * record. A disc on the artwork and a "record only" tag say so.
             */
            const recordOnly = item.silence === "record-only";
            const silentReason =
              item.silence === "loading"
                ? "Still loading from Discogs — tap to fetch it next"
                : item.silence === "not-loaded"
                  ? "Not synced yet — hit refresh to fetch this release"
                  : recordOnly
                    ? "No YouTube clip — tap for its side, length and a tap pad"
                    : "Discogs has no audio for this pressing";

            return (
              <li
                key={`${item.key}:${index}`}
                data-index={index}
                data-dragging={travelling ? "" : undefined}
                data-selected={ticked ? "" : undefined}
                style={{ height: ROW_HEIGHT }}
                // Draggable, with a mouse, for two reasons: reordering an open
                // playlist, and dropping any playable row onto a playlist in
                // the sidebar. A silent row has nothing to add, so it stays
                // put. Touch reorders by press-and-hold instead (above).
                draggable={
                  finePointer &&
                  (reorderable || item.videoId !== null || item.silence === "record-only")
                }
                onDragStart={(event) => {
                  // The picture (dimming this row) waits for the first
                  // dragenter: a row restyled during dragstart is what the
                  // browser snapshots for the drag image.
                  if (reorderable && writeRowDrag(event.dataTransfer, index)) dragIndex.current = index;
                  writeClipDrag(event.dataTransfer, item.key);
                  // Part of a selection: every ticked track comes along.
                  const keys = dragKeys?.(item.key);
                  if (keys && keys.length > 1) writeClipsDrag(event.dataTransfer, keys);
                }}
                onDragEnd={clearDrag}
                className={`group border-b border-ink-850 ${
                  travelling
                    ? "bg-accent/15 opacity-60"
                    : active
                      ? "bg-accent/10"
                      : ticked
                        ? "bg-ink-800"
                        : "hover:bg-ink-850"
                } ${
                  // A ticked row says so at its edge too, so it still reads as
                  // ticked when it's also the one playing.
                  ticked ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""
                } ${reorderable ? "cursor-grab active:cursor-grabbing" : ""} ${
                  // No text selection or iOS callout on a long press — that
                  // press is picking the record up.
                  touchReorder || selecting ? "select-none [-webkit-touch-callout:none]" : ""
                } ${
                  silent
                    ? recordOnly
                      ? ""
                      : item.silence === "loading"
                        ? "opacity-60"
                        : "opacity-45"
                    : ""
                }`}
              >
                {showTransitions &&
                  (transitions?.get(index) ? (
                    <TransitionStrip check={transitions.get(index)!} />
                  ) : (
                    <div className="h-[22px] px-3 text-[10px] leading-[22px] text-neutral-700">
                      {index === 0 ? "opens the set" : ""}
                    </div>
                  ))}

                <div className="flex items-center gap-3 px-3" style={{ height: BASE_ROW_HEIGHT }}>
                {showChecks && onSelect && (
                  <CheckBox
                    checked={ticked}
                    label={`${ticked ? "Untick" : "Tick"} ${item.title}`}
                    onClick={(event) => onSelect(index, event.shiftKey ? "range" : "toggle")}
                    quiet={!checksOn}
                  />
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    // Ticking: in select mode a tap ticks; with a mouse,
                    // Cmd/Ctrl-click ticks one and Shift-click a run.
                    if (onSelect && (selecting || event.metaKey || event.ctrlKey || event.shiftKey)) {
                      onSelect(index, event.shiftKey ? "range" : "toggle");
                      return;
                    }
                    onPlay(index);
                  }}
                  aria-pressed={selecting ? ticked : undefined}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-sm bg-ink-800">
                    {item.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    {recordOnly ? (
                      <span
                        className="absolute inset-0 grid place-items-center bg-black/55"
                        title={silentReason}
                      >
                        <Disc className="h-4 w-4 text-neutral-300" />
                      </span>
                    ) : silent ? (
                      <span
                        className="absolute inset-0 grid place-items-center bg-black/65"
                        title={silentReason}
                      >
                        <NoPreview className="h-3.5 w-3.5 text-neutral-400" />
                      </span>
                    ) : (
                      <span
                        className={`absolute inset-0 hidden place-items-center bg-black/60 group-hover:grid ${
                          active ? "grid" : ""
                        }`}
                      >
                        <Play className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] ${
                        active ? "font-semibold text-accent" : "text-neutral-200"
                      }`}
                    >
                      {item.position ? (
                        <span className="mr-1.5 font-mono text-[10px] text-neutral-600">
                          {item.position}
                        </span>
                      ) : null}
                      {recordOnly && markRecordOnly && (
                        // On a phone the disc on the artwork says it; the
                        // title needs the width more than the tag does.
                        <span className="mr-1.5 hidden -translate-y-px rounded-sm border border-neutral-700 px-1 align-middle text-[9px] font-medium uppercase leading-[14px] tracking-wide text-neutral-400 sm:inline-block">
                          record only
                        </span>
                      )}
                      {item.title}
                    </span>
                    {phoneMeta && (
                      // The numbers a DJ reads first, held at the right so a
                      // long artist name truncates instead of pushing them off.
                      <span
                        className={`flex min-w-0 items-baseline gap-1.5 text-[11px] text-neutral-500 ${
                          tight ? "" : "sm:hidden"
                        }`}
                      >
                        <span className="min-w-0 truncate">{item.artist}</span>
                        {item.tags && item.tags.length > 0 && (
                          <TagMark tags={item.tags} className="max-w-24 text-[10px]" />
                        )}
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-600">
                          {[
                            item.bpm !== null && item.bpm !== undefined ? `${formatBpm(item.bpm)} BPM` : null,
                            item.duration ? formatTime(item.duration) : null,
                            item.year ? String(item.year) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    )}
                    <span
                      className={`truncate text-[11px] text-neutral-500 ${
                        phoneMeta ? (tight ? "hidden" : "hidden sm:block") : "block"
                      }`}
                    >
                      {item.artist}
                      <span className="text-neutral-700"> — {item.releaseTitle}</span>
                      {silent && !recordOnly && (
                        <span className="ml-1.5 text-neutral-600">
                          ·{" "}
                          {item.silence === "loading"
                            ? "loading"
                            : item.silence === "not-loaded"
                              ? "not synced"
                              : "no preview"}
                        </span>
                      )}
                    </span>
                  </span>

                  {/* In a tight list the numbers move into the second line (above). */}
                  <span className={`hidden shrink-0 items-center gap-2 ${tight && phoneMeta ? "" : "sm:flex"}`}>
                    {item.tags && item.tags.length > 0 && (
                      <TagMark
                        tags={item.tags}
                        className="max-w-28 rounded-sm border border-accent/30 px-1.5 py-0.5 text-[10px]"
                      />
                    )}
                    {item.styles[0] && !tight && (
                      <span className="rounded-sm bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        {item.styles[0]}
                      </span>
                    )}
                    <span
                      className={`hidden w-8 text-right font-mono text-[10px] text-neutral-600 ${tight ? "" : "sm:inline"}`}
                    >
                      {item.year ?? ""}
                    </span>
                    <span
                      className={`hidden w-12 text-right font-mono text-[10px] text-neutral-600 ${tight ? "" : "md:inline"}`}
                      title={
                        item.addedAt
                          ? `Added ${new Date(item.addedAt).toLocaleDateString()}`
                          : "No date from Discogs"
                      }
                    >
                      {formatAdded(item.addedAt)}
                    </span>
                    {/*
                      BPM sits immediately left of the runtime and holds its
                      column whether or not there is a reading, so the numbers
                      stay in a scannable line down the list. When you are
                      ordering a set, a tempo that jumps position row to row is
                      unreadable — the alignment is the feature.

                      An em-dash rather than a blank says "not measured yet",
                      which is different from "no tempo", and pushes you toward
                      the tracks worth playing through to fill in.
                    */}
                    <span
                      className={`w-11 text-right font-mono text-[10px] tabular-nums ${
                        item.bpm !== null && item.bpm !== undefined
                          ? "text-accent/80"
                          : "text-neutral-700"
                      }`}
                      title={
                        item.bpm !== null && item.bpm !== undefined
                          ? `${item.bpm} BPM`
                          : "No BPM yet — play it through, or tap T"
                      }
                    >
                      {formatBpm(item.bpm)}
                    </span>
                    <span className="w-10 text-right font-mono text-[10px] tabular-nums text-neutral-600">
                      {item.duration ? formatTime(item.duration) : "--:--"}
                    </span>
                  </span>
                </button>

                {addedBy && (
                  // A fixed-width slot, so a long name doesn't push the BPM
                  // and runtime columns out of line with the rows around it.
                  <span className="flex w-16 shrink-0 justify-end">
                    {(() => {
                      const who = addedBy(item, index);
                      return who ? (
                        <span
                          className="max-w-full truncate rounded-full bg-accent-alt/10 px-1.5 py-0.5 text-[10px] text-accent-alt/90"
                          title={`Added by ${who}`}
                        >
                          {who}
                        </span>
                      ) : null;
                    })()}
                  </span>
                )}

                {rowActions && <ShareButton track={item} />}

                {rowActions && onAdd && (!silent || item.silence === "record-only") && (
                  <button
                    type="button"
                    onClick={(event) => onAdd(item, event.shiftKey)}
                    title={`${addLabel} — Shift-click to choose`}
                    aria-label={`${addLabel}: ${item.title}`}
                    className="shrink-0 rounded-sm p-1.5 text-neutral-600 transition-opacity hover:bg-ink-800 hover:text-accent focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}

                {/*
                  Not yours to take out: on a shared set, a collaborator
                  removes only what they added. A lock where the trash would
                  be, rather than nothing — on a phone an empty space read as
                  a missing button — and a tap says whose it is.
                */}
                {rowActions && onRemove && canRemove && !canRemove(item, index) && (
                  <button
                    type="button"
                    onClick={() => onRemoveRefused?.(item, index)}
                    title="Added by someone else — not yours to take out"
                    aria-label={`${item.title} was added by someone else — not yours to take out`}
                    className="shrink-0 rounded-sm p-1.5 text-neutral-700 transition-opacity hover:bg-ink-800 hover:text-neutral-400 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Lock className="h-3.5 w-3.5" />
                  </button>
                )}
                {rowActions && onRemove && (!canRemove || canRemove(item, index)) && (
                  <button
                    type="button"
                    onClick={() => onRemove(item, index)}
                    title="Remove from playlist"
                    className="shrink-0 rounded-sm p-1.5 text-neutral-600 transition-opacity hover:bg-ink-800 hover:text-red-400 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      </div>
    </div>
  );
}
