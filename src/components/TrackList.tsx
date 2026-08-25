"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Playable } from "@/lib/types";
import { formatTime } from "./NowPlaying";
import { Play, Plus, Trash } from "./Icons";

const ROW_HEIGHT = 56;
const OVERSCAN = 8;

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
  onRemove,
  emptyMessage,
  reorderable = false,
  onReorder,
}: {
  items: Playable[];
  currentKey: string | null;
  onPlay: (index: number) => void;
  onAdd?: (item: Playable) => void;
  onRemove?: (item: Playable, index: number) => void;
  emptyMessage: string;
  reorderable?: boolean;
  onReorder?: (from: number, to: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-600">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={viewportRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div style={{ height: items.length * ROW_HEIGHT, position: "relative" }}>
        <ul
          style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
          className="absolute inset-x-0 top-0"
        >
          {slice.map((item, i) => {
            const index = start + i;
            const active = item.key === currentKey;

            return (
              <li
                key={`${item.key}:${index}`}
                style={{ height: ROW_HEIGHT }}
                draggable={reorderable}
                onDragStart={() => (dragIndex.current = index)}
                onDragOver={(e) => reorderable && e.preventDefault()}
                onDrop={() => {
                  if (!reorderable || dragIndex.current === null) return;
                  onReorder?.(dragIndex.current, index);
                  dragIndex.current = null;
                }}
                className={`group flex items-center gap-3 border-b border-ink-850 px-3 ${
                  active ? "bg-accent/10" : "hover:bg-ink-850"
                } ${reorderable ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onPlay(index)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-ink-800">
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
                    <span
                      className={`absolute inset-0 hidden place-items-center bg-black/60 group-hover:grid ${
                        active ? "grid" : ""
                      }`}
                    >
                      <Play className="h-3 w-3 text-white" />
                    </span>
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
                      {item.title}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {item.artist}
                      <span className="text-neutral-700"> — {item.releaseTitle}</span>
                    </span>
                  </span>

                  <span className="hidden shrink-0 items-center gap-2 sm:flex">
                    {item.styles[0] && (
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        {item.styles[0]}
                      </span>
                    )}
                    {item.year && (
                      <span className="font-mono text-[10px] text-neutral-600">
                        {item.year}
                      </span>
                    )}
                    <span className="w-10 text-right font-mono text-[10px] tabular-nums text-neutral-600">
                      {item.duration ? formatTime(item.duration) : "--:--"}
                    </span>
                  </span>
                </button>

                {onAdd && (
                  <button
                    type="button"
                    onClick={() => onAdd(item)}
                    title="Add to playlist"
                    className="shrink-0 rounded p-1.5 text-neutral-600 opacity-0 transition-opacity hover:bg-ink-800 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}

                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item, index)}
                    title="Remove from playlist"
                    className="shrink-0 rounded p-1.5 text-neutral-600 opacity-0 transition-opacity hover:bg-ink-800 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
