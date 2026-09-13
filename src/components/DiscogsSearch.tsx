"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchHit } from "@/lib/discogs";
import { badgeFor, ownershipFrom, type RowAction } from "@/client/ownership";
import { Heart, Plus, Search } from "./Icons";

/**
 * Look a record up on Discogs and put it in your collection.
 *
 * This is the one place the app reaches outside what you own. It exists
 * because of a gap in the loop it otherwise closes: records arrive in the
 * post, and until now adding them meant leaving for discogs.com, searching a
 * site that is hostile on a phone, and coming back.
 *
 * The disambiguation line is the whole design. Discogs will return twelve
 * pressings of the same record that look identical until you open each one,
 * and you are not looking for "a pressing of this record" — you are looking
 * for the one in your hand. Year, catalogue number, label, country and format
 * on one line answer that without a single tap.
 */

interface Props {
  /** Ids already known, so a row can say what you already have. */
  sets: { collection: Set<number>; wantlist: Set<number> };
  /** Pre-fills the box — used when a crate search came back empty. */
  initialQuery?: string;
  onAddToCollection: (hit: SearchHit) => Promise<void>;
  onAddToWantlist: (hit: SearchHit) => Promise<void>;
}

/*
 * Shared with ownership.ts, which owns the rule about which of "you already
 * had this" and "you just added this" gets to render. Keeping the union in
 * one place means a new row state cannot be added here and silently fall
 * through that rule.
 */
type RowState = RowAction;

export function DiscogsSearch({
  sets,
  initialQuery = "",
  onAddToCollection,
  onAddToWantlist,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});

  /*
   * Searching is explicit — submit, not debounced-as-you-type. Discogs allows
   * 60 authenticated requests a minute for the whole account, shared with a
   * collection sync that may be running in another tab. Firing a request per
   * keystroke would race the thing that makes the app usable at all.
   */
  const inFlight = useRef(0);

  const run = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMessage("Type at least two characters.");
      return;
    }

    const ticket = ++inFlight.current;
    setStatus("searching");
    setMessage(null);

    try {
      const response = await fetch(
        `/api/discogs/search?q=${encodeURIComponent(trimmed)}`,
        { headers: { Accept: "application/json" } },
      );
      // A slower earlier search must not overwrite a newer one's results.
      if (ticket !== inFlight.current) return;

      if (!response.ok) {
        setStatus("error");
        setMessage(
          response.status === 429
            ? "Discogs is rate limiting — give it a moment."
            : "Couldn't reach Discogs.",
        );
        return;
      }

      const body = (await response.json()) as { results: SearchHit[] };
      setHits(body.results);
      setStatus("idle");
      if (body.results.length === 0) {
        setMessage("Nothing matched. Try the catalogue number off the label.");
      }
    } catch {
      if (ticket !== inFlight.current) return;
      setStatus("error");
      setMessage("Couldn't reach Discogs.");
    }
  }, [query]);

  const act = async (hit: SearchHit, kind: "collection" | "wantlist") => {
    setRows((r) => ({ ...r, [hit.id]: "working" }));
    try {
      if (kind === "collection") await onAddToCollection(hit);
      else await onAddToWantlist(hit);
      setRows((r) => ({ ...r, [hit.id]: kind === "collection" ? "collected" : "wanted" }));
    } catch {
      setRows((r) => ({ ...r, [hit.id]: "failed" }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex shrink-0 gap-2 border-b border-ink-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Artist, title, or catalogue number…"
          aria-label="Search Discogs"
          className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600"
        />
        <button
          type="submit"
          disabled={status === "searching"}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          {status === "searching" ? "…" : "Search"}
        </button>
      </form>

      {message && (
        <p role="status" className="shrink-0 px-4 pb-2 text-xs text-neutral-500">
          {message}
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {(hits ?? []).map((hit) => {
          const state = rows[hit.id] ?? "idle";
          const badge = badgeFor(ownershipFrom(sets, hit.id), state);

          return (
            <li
              key={hit.id}
              className="flex items-start gap-3 border-t border-ink-800 px-4 py-3"
            >
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded bg-ink-800">
                {hit.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hit.thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-neutral-100">
                  {hit.title}
                </span>
                <span className="block truncate text-[11px] text-neutral-500">
                  {hit.artist}
                </span>

                {/*
                  The line that does the work. Interpunct-separated and
                  truncated rather than wrapped, so every row is the same
                  height and the list stays scannable — which is the only way
                  twelve near-identical pressings are tellable apart at speed.
                */}
                <span className="mt-0.5 block truncate font-mono text-[10px] text-neutral-600">
                  {[
                    hit.year ?? null,
                    hit.catno,
                    hit.labels[0] ?? null,
                    hit.country,
                    hit.formats[0] ?? null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>

                {badge && (
                  <span className="mt-1 inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                    {badge}
                  </span>
                )}
                {state === "failed" && (
                  <span className="mt-1 inline-block px-1.5 text-[10px] text-red-300">
                    Didn&apos;t save — try again
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void act(hit, "wantlist")}
                  disabled={state === "working"}
                  aria-label="Add to wantlist"
                  title="Add to wantlist"
                  className="rounded-full p-2 text-neutral-500 hover:text-accent active:bg-ink-800 disabled:opacity-40"
                >
                  <Heart className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void act(hit, "collection")}
                  disabled={state === "working"}
                  aria-label="Add to collection"
                  title="Add to collection"
                  className="rounded-full p-2 text-neutral-500 hover:text-accent active:bg-ink-800 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
