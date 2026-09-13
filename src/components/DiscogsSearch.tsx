"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchHit } from "@/lib/discogs";
import type { ReleaseDetail } from "@/lib/types";
import { releasesApi } from "@/client/api";
import { releaseUrl } from "@/lib/discogs-links";
import { badgeFor, ownershipFrom, type RowAction } from "@/client/ownership";
import {
  SEARCH_FIELDS,
  searchQueryFor,
  specFor,
  tooShortMessage,
  type SearchField,
} from "@/client/searchFields";
import { Heart, InCollection, NoPreview, Plus, Search } from "./Icons";

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
  const [field, setField] = useState<SearchField>("all");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});

  /*
   * Expanding a row costs one Discogs request, which is why it happens on tap
   * rather than for every result. It is also the only point at which this
   * panel can honestly say whether a pressing has anything to play: the
   * search endpoint returns no video links at all, so before you open a row
   * we genuinely do not know.
   */
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<
    Record<number, ReleaseDetail | "loading" | "failed">
  >({});

  const toggle = useCallback(
    (releaseId: number) => {
      setOpenId((current) => (current === releaseId ? null : releaseId));
      setDetail((current) => {
        if (current[releaseId] !== undefined) return current;

        void (async () => {
          try {
            const { results } = await releasesApi.detail([releaseId]);
            const found = results.find((r) => r.id === releaseId);
            setDetail((d) => ({
              ...d,
              [releaseId]: found?.ok ? found.release : "failed",
            }));
          } catch {
            setDetail((d) => ({ ...d, [releaseId]: "failed" }));
          }
        })();

        return { ...current, [releaseId]: "loading" };
      });
    },
    [],
  );

  /*
   * Searching is explicit — submit, not debounced-as-you-type. Discogs allows
   * 60 authenticated requests a minute for the whole account, shared with a
   * collection sync that may be running in another tab. Firing a request per
   * keystroke would race the thing that makes the app usable at all.
   */
  const inFlight = useRef(0);

  const run = useCallback(async () => {
    const search = searchQueryFor(field, query);
    if (search === null) {
      setMessage(tooShortMessage(field));
      return;
    }

    const ticket = ++inFlight.current;
    setStatus("searching");
    setMessage(null);

    try {
      const response = await fetch(`/api/discogs/search?${search}`, {
        headers: { Accept: "application/json" },
      });
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
        // Point at the next field to try rather than at a dead end. The
        // commonest miss by far is a track title searched as a release title.
        setMessage(
          field === "all"
            ? "Nothing matched. If that was a track name, try Track."
            : field === "track"
              ? "No tracklist matched. Try All, or the catalogue number."
              : "Nothing matched that exactly. Try All.",
        );
      }
    } catch {
      if (ticket !== inFlight.current) return;
      setStatus("error");
      setMessage("Couldn't reach Discogs.");
    }
  }, [query, field]);

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
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 shrink-0 border-b border-ink-800 bg-ink-900">
        <form
          className="flex gap-2 px-3 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={specFor(field).placeholder}
            aria-label={`Search Discogs by ${specFor(field).label}`}
            /*
             * 16px on a phone, deliberately. Anything smaller and iOS Safari
             * zooms the page on focus, which on a sheet means the sheet is
             * suddenly the wrong size and cannot be scrolled back.
             */
            className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-base text-neutral-200 placeholder:text-neutral-600 sm:text-sm"
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

        {/*
          Which field the search runs against. Not inferred from the shape of
          what you typed: plenty of real record titles look like catalogue
          numbers, and a search that quietly ran a different query than you
          asked for is worse than one extra tap.
        */}
        <div role="group" aria-label="Search field" className="flex gap-1.5 px-3 py-2">
          {SEARCH_FIELDS.map((spec) => (
            <button
              key={spec.key}
              type="button"
              onClick={() => setField(spec.key)}
              aria-pressed={field === spec.key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                field === spec.key
                  ? "bg-accent text-ink-950"
                  : "border border-ink-700 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {spec.label}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <p role="status" className="shrink-0 px-4 pb-2 text-xs text-neutral-500">
          {message}
        </p>
      )}

      <ul>
        {(hits ?? []).map((hit) => {
          const state = rows[hit.id] ?? "idle";
          const badge = badgeFor(ownershipFrom(sets, hit.id), state);

          return (
            <li key={hit.id} className="border-t border-ink-800">
              <div className="flex items-start gap-3 px-4 py-3">
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

              <button
                type="button"
                onClick={() => toggle(hit.id)}
                aria-expanded={openId === hit.id}
                className="min-w-0 flex-1 text-left"
              >
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
                  <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    <InCollection className="h-2.5 w-2.5" />
                    {badge}
                  </span>
                )}
                {state === "failed" && (
                  <span className="mt-1 inline-block px-1.5 text-[10px] text-red-300">
                    Didn&apos;t save — try again
                  </span>
                )}
              </button>

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
              </div>

              {openId === hit.id && (
                <ReleasePanel
                  hit={hit}
                  detail={detail[hit.id]}
                  owned={badge}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What one release looks like when you open it.
 *
 * This panel exists for a fact the list above cannot know. Discogs' search
 * endpoint returns no video links, so before this fetch there is no honest
 * way to tell you whether a pressing has anything to play — and guessing
 * would mean marking records "no preview" that play perfectly well.
 *
 * So the answer lives here, one release at a time, paid for by a tap.
 */
function ReleasePanel({
  hit,
  detail,
  owned,
}: {
  hit: SearchHit;
  detail: ReleaseDetail | "loading" | "failed" | undefined;
  owned: string | null;
}) {
  return (
    <div className="border-t border-ink-850 bg-ink-950/60 px-4 py-3">
      {owned && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
          <InCollection className="h-3 w-3" />
          {owned}
        </p>
      )}

      {detail === undefined || detail === "loading" ? (
        <p className="text-[11px] text-neutral-600">Loading the release…</p>
      ) : detail === "failed" ? (
        /*
         * Says what is unknown rather than inventing a state. "No previews"
         * here would be a claim about the record made from a failure of ours.
         */
        <p className="text-[11px] text-neutral-500">
          Couldn&apos;t load this release — so there&apos;s no saying yet
          whether it has anything to play.
        </p>
      ) : (
        <>
          {detail.videos.length === 0 ? (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-400/90">
              <NoPreview className="h-3 w-3" />
              No previews on Discogs for this pressing — you can own it, but it
              won&apos;t play here.
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-neutral-500">
              {detail.videos.length}{" "}
              {detail.videos.length === 1 ? "preview" : "previews"} on Discogs.
            </p>
          )}

          {detail.tracks.length > 0 && (
            <ol className="mb-2 space-y-0.5">
              {detail.tracks.slice(0, 12).map((track, index) => (
                <li
                  key={`${track.position}:${index}`}
                  className="flex gap-2 text-[11px] text-neutral-400"
                >
                  <span className="w-7 shrink-0 font-mono text-[10px] text-neutral-600">
                    {track.position}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{track.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-600">
                    {track.duration}
                  </span>
                </li>
              ))}
              {detail.tracks.length > 12 && (
                <li className="pl-9 text-[10px] text-neutral-600">
                  + {detail.tracks.length - 12} more
                </li>
              )}
            </ol>
          )}

          {detail.market && detail.market.forSale > 0 && (
            <p className="text-[11px] text-neutral-500">
              {detail.market.forSale} for sale
              {detail.market.lowestPrice !== null &&
                `, from ${detail.market.lowestPrice}`}
            </p>
          )}
        </>
      )}

      <a
        href={releaseUrl(hit.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-[11px] text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-accent"
      >
        Open on Discogs
      </a>
    </div>
  );
}
