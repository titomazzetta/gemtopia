"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { DigResult, Playable, ReleaseDetail } from "@/lib/types";
import { digWithinCollection, type LocalLane } from "@/client/digLocal";
import { recordQueue, runningOrder, type RunningOrder } from "@/client/recordOrder";
import { ApiError, digApi, releasesApi, wantlistApi } from "@/client/api";
import { addedCount, appendLanes, nextDigPage, revealMore, visibleCount } from "@/client/digFeed";
import { formatTime } from "./NowPlaying";
import { Disc, Heart, Play, Plus, Search, Shuffle, Sparkle } from "./Icons";
import { formatBpm } from "@/lib/mixing";

/**
 * Off-the-cuff digging.
 *
 * The interaction this is built around: something comes up on shuffle, you
 * want to know more, and you want to fall sideways into whatever it connects
 * to — without losing your place.
 *
 * Two halves, deliberately different in speed and cost:
 *
 *   IN YOUR CRATE     instant, no network. Pivot on artist, label, style,
 *                     era, country, or mixable tempo. Everything here is
 *                     already yours and already playable.
 *
 *   BEYOND YOUR CRATE four Discogs lookups. Records you do not own, each
 *                     tagged with the relationship that surfaced it. Preview
 *                     the audio, add to your wantlist, or dig again from it —
 *                     which is what makes it endless.
 *
 * Every value shown is Discogs metadata. Every chip is a pivot.
 *
 * Note there is no "reset when the seed changes" effect here: the parent gives
 * this component a `key` of the seed's clip key, so React remounts it and every
 * piece of local state starts fresh. That is both simpler and less bug-prone
 * than trying to remember which of six state variables need clearing.
 */

type Half = "crate" | "beyond";

function MetaChip({
  label,
  value,
  onClick,
  active,
}: {
  label?: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      {label && <span className="mr-1 text-neutral-600">{label}</span>}
      <span className={active ? "text-accent" : "text-neutral-300"}>{value}</span>
    </>
  );

  if (!onClick) {
    return (
      <span className="rounded-full border border-ink-700 bg-ink-850 px-2 py-1 text-[11px]">
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
        active
          ? "border-accent/60 bg-accent/15"
          : "border-ink-700 bg-ink-850 hover:border-ink-600 hover:bg-ink-800"
      }`}
      title="Filter the crate by this"
    >
      {content}
    </button>
  );
}

function LocalRow({
  item,
  onPlay,
  onAdd,
}: {
  item: Playable;
  onPlay: () => void;
  onAdd: () => void;
}) {
  return (
    <li className="group flex w-56 shrink-0 flex-col rounded-md border border-ink-800 bg-ink-850 p-2 hover:border-ink-600">
      <button type="button" onClick={onPlay} className="flex items-start gap-2 text-left">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded bg-ink-800">
          {item.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <Disc className="h-4 w-4 text-neutral-700" />
          )}
          <span className="absolute inset-0 hidden place-items-center bg-black/60 group-hover:grid">
            <Play className="h-3 w-3 text-white" />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-neutral-200">{item.title}</span>
          <span className="block truncate text-[10px] text-neutral-500">{item.artist}</span>
        </span>
      </button>

      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-neutral-600">
        {item.bpm !== null && (
          <span className="rounded bg-ink-800 px-1 font-mono text-accent/80">{formatBpm(item.bpm, { precise: true })}</span>
        )}
        {item.year && <span>{item.year}</span>}
        {item.duration && <span className="ml-auto font-mono">{formatTime(item.duration)}</span>}
        <button
          type="button"
          onClick={onAdd}
          title="Add to playlist"
          className="ml-auto rounded p-0.5 text-neutral-600 hover:bg-ink-800 hover:text-accent"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function BeyondCard({
  result,
  wanted,
  busy,
  previewState,
  onPreview,
  onWant,
  onDigFrom,
}: {
  result: DigResult;
  wanted: boolean;
  busy: boolean;
  previewState: "idle" | "loading" | "none";
  onPreview: () => void;
  onWant: () => void;
  onDigFrom: () => void;
}) {
  return (
    <li className="flex w-60 shrink-0 flex-col rounded-md border border-ink-800 bg-ink-850 p-2">
      <div className="flex gap-2">
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-ink-800">
          {result.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <Disc className="h-5 w-5 text-neutral-700" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <a
            href={result.discogsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[12px] font-medium text-neutral-100 hover:text-accent"
            title={`${result.artist} — ${result.title}`}
          >
            {result.title}
          </a>
          <span className="block truncate text-[10px] text-neutral-500">{result.artist}</span>
          <span className="block truncate text-[10px] text-neutral-600">
            {result.year ?? "—"}
            {result.labels[0] ? ` · ${result.labels[0]}` : ""}
          </span>
        </div>
      </div>

      {(result.want !== null || result.market) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] text-neutral-600">
          {result.want !== null && <span>{result.want.toLocaleString()} want it</span>}
          {result.market && result.market.forSale > 0 && (
            <a
              href={result.marketplaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-ink-800 px-1 py-0.5 text-accent/80 hover:text-accent"
            >
              {result.market.forSale} for sale
              {result.market.lowestPrice ? ` · from ${result.market.lowestPrice}` : ""}
            </a>
          )}
          {result.market && result.market.forSale === 0 && (
            <span className="rounded bg-ink-800 px-1 py-0.5">none for sale</span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onPreview}
          disabled={previewState === "loading" || previewState === "none"}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-ink-700 py-1 text-[10px] text-neutral-300 hover:border-ink-600 hover:text-white disabled:opacity-40"
          title={
            previewState === "none"
              ? "Discogs has no audio for this release"
              : "Play it without owning it"
          }
        >
          <Play className="h-2.5 w-2.5" />
          {previewState === "loading" ? "…" : previewState === "none" ? "no audio" : "preview"}
        </button>

        <button
          type="button"
          onClick={onWant}
          disabled={busy}
          title={wanted ? "Remove from your Discogs wantlist" : "Add to your Discogs wantlist"}
          className={`rounded border px-1.5 py-1 transition-colors disabled:opacity-40 ${
            wanted
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-ink-700 text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
          }`}
        >
          <Heart className="h-3 w-3" filled={wanted} />
        </button>

        <button
          type="button"
          onClick={onDigFrom}
          title="Dig from this record instead"
          className="rounded border border-ink-700 px-1.5 py-1 text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
        >
          <Search className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function Lane({
  title,
  subtitle,
  count,
  end,
  children,
}: {
  title: string;
  subtitle?: string;
  /** "16 of 58" — so a lane never looks like it simply stops. */
  count?: string;
  /** The last tile: more, deeper, or where to go next. Never a blank edge. */
  end?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1.5 flex items-baseline gap-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
        {subtitle && <span className="normal-case tracking-normal text-accent/80">{subtitle}</span>}
        {count && <span className="ml-auto font-normal normal-case tracking-normal text-neutral-600">{count}</span>}
      </h4>
      <ul className="flex gap-2 overflow-x-auto px-4 pb-2">
        {children}
        {end && <li className="flex w-40 shrink-0">{end}</li>}
      </ul>
    </section>
  );
}

/** The tile at the end of a lane. */
function EndTile({
  onClick,
  disabled,
  title,
  detail,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  detail?: string;
}) {
  const body = (
    <>
      <span className="text-xs font-semibold text-accent">{title}</span>
      {detail && <span className="mt-1 text-[10px] leading-snug text-neutral-500">{detail}</span>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[56px] w-full flex-col items-center justify-center rounded-md border border-dashed border-ink-700 p-2 text-center hover:border-accent/50 disabled:opacity-40"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-h-[56px] w-full flex-col items-center justify-center rounded-md border border-dashed border-ink-800 p-2 text-center">
      {body}
    </div>
  );
}

/**
 * The whole record, in the order it was pressed. See client/recordOrder.ts.
 *
 * Tracks Discogs has no clip for are listed anyway, dimmed. Hiding them would
 * make a four-track EP look like a two-track single, which is the opposite of
 * what someone opening "the whole record" wants to know.
 */
export function RecordSection({
  order,
  releaseTitle,
  year,
  onPlay,
  onPlayExtra,
}: {
  order: RunningOrder;
  releaseTitle: string;
  year: number | null;
  /** Index into the playable tracks, in running order. */
  onPlay: (index: number) => void;
  onPlayExtra: (item: Playable) => void;
}) {
  const playable = order.rows.filter((row) => row.playable !== null);
  if (order.rows.length === 0 && order.extras.length === 0) return null;

  // Map each row to its index in the playable queue, so a click starts the
  // record from that track rather than from the top.
  let cursor = 0;
  const queueIndex = order.rows.map((row) => (row.playable ? cursor++ : -1));

  return (
    <section className="mx-4 mb-4 rounded-md border border-ink-800 bg-ink-850/50">
      <header className="flex items-center gap-2 border-b border-ink-800 px-3 py-2">
        <Disc className="h-3.5 w-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-neutral-100">
            {releaseTitle || "This record"}
            {year ? <span className="font-normal text-neutral-600"> · {year}</span> : null}
          </p>
          <p className="text-[10px] text-neutral-600">
            {order.rows.length > 0
              ? `${order.rows.length} tracks · ${playable.length} with audio`
              : "Clips on YouTube for this release"}
          </p>
        </div>
        {playable.length > 1 && (
          <button
            type="button"
            onClick={() => onPlay(0)}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-ink-950"
            title="Play the record in order, then return to your shuffle"
          >
            <Play className="h-3 w-3" />
            Play the record
          </button>
        )}
      </header>

      {order.rows.length > 0 && (
        <ol className="max-h-72 overflow-y-auto py-1">
          {order.rows.map((row, index) => {
            const at = queueIndex[index]!;
            const content = (
              <>
                <span className="w-7 shrink-0 font-mono text-[10px] text-neutral-600">
                  {row.position}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    row.current
                      ? "font-medium text-accent"
                      : row.playable
                        ? "text-neutral-200"
                        : "text-neutral-600"
                  }`}
                >
                  {row.title}
                </span>
                {row.current ? (
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-accent">
                    playing
                  </span>
                ) : !row.playable ? (
                  <span className="shrink-0 text-[9px] text-neutral-700">no clip</span>
                ) : null}
                {row.duration && (
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-neutral-600">
                    {row.duration}
                  </span>
                )}
              </>
            );

            return (
              <li key={`${row.position}:${index}`}>
                {row.playable ? (
                  <button
                    type="button"
                    onClick={() => onPlay(at)}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-ink-800 lg:py-1.5 ${
                      row.current ? "bg-accent/5" : ""
                    }`}
                    title="Play from here, then return to your shuffle"
                    aria-current={row.current ? "true" : undefined}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs lg:py-1.5">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {order.extras.length > 0 && (
        <div className="border-t border-ink-800 px-3 py-2">
          <p className="mb-1 text-[10px] text-neutral-600">
            Also on YouTube for this release — full sides, rips and mixes
          </p>
          <div className="flex flex-wrap gap-1">
            {order.extras.slice(0, 6).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onPlayExtra(item)}
                className="max-w-full truncate rounded-full border border-ink-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function DigDrawer({
  seed,
  seedDetail,
  pool,
  collectionIds,
  wantlistIds,
  pitchPercent,
  onClose,
  onPlayLocal,
  onPlayRecord,
  onAddToPlaylist,
  onPivot,
  onPreviewExternal,
  onWantlistChange,
  say,
}: {
  seed: Playable;
  seedDetail: ReleaseDetail | null;
  pool: Playable[];
  collectionIds: Set<number>;
  wantlistIds: Set<number>;
  /** Deck pitch range, so the "mixes with" lane reflects your actual gear. */
  pitchPercent: number;
  onClose: () => void;
  onPlayLocal: (items: Playable[], index: number) => void;
  /** Play the record in running order as a detour from the shuffle. */
  onPlayRecord: (items: Playable[], index: number, label: string) => void;
  onAddToPlaylist: (item: Playable) => void;
  /** Apply a facet to the main crate filter and close the drawer. */
  onPivot: (facet: "artists" | "labels" | "styles" | "genres" | "countries", value: string) => void;
  /** Play a release that is not in the collection. */
  onPreviewExternal: (release: ReleaseDetail) => void;
  onWantlistChange: (releaseId: number, wanted: boolean) => void;
  say: (message: string) => void;
}) {
  const [half, setHalf] = useState<Half>("crate");
  const [beyond, setBeyond] = useState<DigResult[] | null>(null);
  const [beyondLanes, setBeyondLanes] = useState<
    Array<{ lane: string; label: string; results: DigResult[] }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyRelease, setBusyRelease] = useState<number | null>(null);
  const [previewStates, setPreviewStates] = useState<Record<number, "idle" | "loading" | "none">>({});
  const [marketByRelease, setMarketByRelease] = useState<Record<number, ReleaseDetail["market"]>>({});
  /** Crate lanes: how many records each has revealed so far. */
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  /** Beyond: the upstream page last read, and whether the corner is dug out. */
  const [digPage, setDigPage] = useState(1);
  const [dugOut, setDugOut] = useState(false);

  // Everything shown this session, so "dig again" keeps moving.
  const seenRef = useRef<Set<number>>(new Set());
  const [digSeed, setDigSeed] = useState<{
    releaseId: number;
    artistIds: number[];
    artistNames: string[];
    labelIds: number[];
    labelNames: string[];
    styles: string[];
    genres: string[];
    year: number | null;
    country: string | null;
    display: string;
  } | null>(null);

  const localLanes: LocalLane[] = useMemo(
    () => digWithinCollection(seed, pool, { pitchPercent }),
    [seed, pool, pitchPercent],
  );

  const record: RunningOrder = useMemo(
    () => runningOrder(seed, seedDetail, pool),
    [seed, seedDetail, pool],
  );

  const buildSeed = useCallback(
    (detail: ReleaseDetail | null) => {
      if (!detail) return null;
      return {
        releaseId: detail.id,
        artistIds: detail.artistIds,
        artistNames: detail.artist.split(/,\s*|\s+&\s+/).slice(0, 12),
        labelIds: detail.labelIds,
        labelNames: detail.labels,
        styles: detail.styles,
        genres: detail.genres,
        year: detail.year,
        country: detail.country,
        display: `${detail.artist} — ${detail.title}`,
      };
    },
    [],
  );

  const runDig = useCallback(
    async (
      payloadSeed: NonNullable<ReturnType<typeof buildSeed>>,
      options: { page?: number; append?: boolean } = {},
    ) => {
      const page = options.page ?? 1;
      const append = options.append ?? false;
      setLoading(true);
      setError(null);
      try {
        const response = await digApi.dig({
          seed: {
            releaseId: payloadSeed.releaseId,
            artistIds: payloadSeed.artistIds,
            artistNames: payloadSeed.artistNames,
            labelIds: payloadSeed.labelIds,
            labelNames: payloadSeed.labelNames,
            styles: payloadSeed.styles,
            genres: payloadSeed.genres,
            year: payloadSeed.year,
            country: payloadSeed.country,
          },
          excludeReleaseIds: [...collectionIds],
          seenReleaseIds: [...seenRef.current],
          includeWantlist: true,
          wantlistReleaseIds: [...wantlistIds],
          page,
        });

        for (const lane of response.lanes) {
          for (const result of lane.results) seenRef.current.add(result.releaseId);
        }

        setDigPage(page);

        if (append) {
          const merged = appendLanes(beyondLanes, response.lanes);
          // Nothing new on this page: the corner is dug out. The per-record
          // dig button is how you move on from here.
          setDugOut(addedCount(beyondLanes, merged) === 0);
          setBeyondLanes(merged);
          setBeyond(merged.flatMap((l) => l.results));
        } else {
          setBeyondLanes(response.lanes);
          setBeyond(response.lanes.flatMap((l) => l.results));
          setDugOut(false);
          if (response.lanes.length === 0) {
            setError("Nothing new — you may already own most of this corner.");
          }
        }
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "Could not reach Discogs.",
        );
      } finally {
        setLoading(false);
      }
    },
    [collectionIds, wantlistIds, beyondLanes],
  );

  /** Next page of the same lookups, appended to the lanes on screen. */
  const digDeeper = useCallback(() => {
    if (!digSeed || loading) return;
    const next = nextDigPage(digPage);
    if (next === null) {
      setDugOut(true);
      return;
    }
    void runDig(digSeed, { page: next, append: true });
  }, [digSeed, loading, digPage, runDig]);

  const startBeyond = useCallback(() => {
    setHalf("beyond");
    const built = digSeed ?? buildSeed(seedDetail);
    if (!built) {
      setError("This release is not in the local cache yet — let the sync finish.");
      return;
    }
    setDigSeed(built);
    void runDig(built);
  }, [digSeed, buildSeed, seedDetail, runDig]);

  /** Load a non-owned release's audio and marketplace info, then play it. */
  const preview = useCallback(
    async (releaseId: number) => {
      setPreviewStates((s) => ({ ...s, [releaseId]: "loading" }));
      try {
        const { results } = await releasesApi.detail([releaseId]);
        const first = results[0];
        if (!first || !first.ok) throw new Error("unavailable");

        setMarketByRelease((m) => ({ ...m, [releaseId]: first.release.market }));

        if (first.release.videos.length === 0) {
          setPreviewStates((s) => ({ ...s, [releaseId]: "none" }));
          say("Discogs has no audio linked to that release.");
          return;
        }

        setPreviewStates((s) => ({ ...s, [releaseId]: "idle" }));
        onPreviewExternal(first.release);
      } catch (caught) {
        setPreviewStates((s) => ({ ...s, [releaseId]: "idle" }));
        say(caught instanceof ApiError ? caught.message : "Could not load that release.");
      }
    },
    [onPreviewExternal, say],
  );

  const toggleWant = useCallback(
    async (releaseId: number) => {
      const wanted = wantlistIds.has(releaseId);
      setBusyRelease(releaseId);
      try {
        if (wanted) {
          await wantlistApi.remove(releaseId);
          onWantlistChange(releaseId, false);
          say("Removed from your Discogs wantlist.");
        } else {
          await wantlistApi.add(releaseId);
          onWantlistChange(releaseId, true);
          say("Added to your Discogs wantlist.");
        }
      } catch (caught) {
        say(caught instanceof ApiError ? caught.message : "Wantlist update failed.");
      } finally {
        setBusyRelease(null);
      }
    },
    [wantlistIds, onWantlistChange, say],
  );

  const digFrom = useCallback(
    (result: DigResult) => {
      const next = {
        releaseId: result.releaseId,
        artistIds: [] as number[],
        artistNames: [result.artist],
        labelIds: [] as number[],
        labelNames: result.labels,
        styles: result.styles,
        genres: result.genres,
        year: result.year,
        country: result.country,
        display: `${result.artist} — ${result.title}`,
      };
      setDigSeed(next);
      void runDig(next, { page: 1 });
    },
    [runDig],
  );

  const detail = seedDetail;

  return (
    /*
      On a phone the drawer shares the screen with the video and the player
      bar, so a fixed header over a scrolling body left the body about zero
      pixels tall — the lanes were there, just never visible. Below lg the
      whole drawer is one scroll, with the crate/beyond switch pinned; from lg
      up it is the original fixed header over a scrolling body.
    */
    <div className="flex h-full flex-col overflow-y-auto overscroll-contain bg-ink-950 lg:overflow-hidden">
      {/* ---- seed header ---- */}
      <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 bg-ink-900 p-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded bg-ink-800">
          {seed.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seed.thumb} alt="" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <Disc className="h-6 w-6 text-neutral-700" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-neutral-100">{seed.title}</h2>
              <p className="truncate text-xs text-neutral-400">{seed.artist}</p>
              <p className="truncate text-[11px] text-neutral-600">
                {seed.releaseTitle}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded border border-ink-700 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-100"
            >
              Close
            </button>
          </div>

          {/* Every field Discogs gave us, every one a pivot. */}
          <div className="mt-2 flex flex-wrap gap-1">
            <MetaChip value={seed.artist} onClick={() => onPivot("artists", seed.artist)} />
            {seed.labels.map((label) => (
              <MetaChip key={label} value={label} onClick={() => onPivot("labels", label)} />
            ))}
            {seed.styles.map((style) => (
              <MetaChip key={style} value={style} onClick={() => onPivot("styles", style)} />
            ))}
            {seed.genres.map((genre) => (
              <MetaChip key={genre} value={genre} onClick={() => onPivot("genres", genre)} />
            ))}
            {seed.country !== null && (
              <MetaChip
                value={seed.country}
                onClick={() => onPivot("countries", seed.country as string)}
              />
            )}
            {seed.year && <MetaChip label="year" value={String(seed.year)} />}
            {seed.formats.slice(0, 3).map((format) => (
              <MetaChip key={format} label="" value={format} />
            ))}
            {seed.bpm !== null && <MetaChip label="bpm" value={String(seed.bpm)} />}
            {seed.position && <MetaChip label="pos" value={seed.position} />}
            {detail?.market && (
              <MetaChip
                label="market"
                value={
                  detail.market.forSale > 0
                    ? `${detail.market.forSale} for sale${detail.market.lowestPrice ? ` · from ${detail.market.lowestPrice}` : ""}`
                    : "none for sale"
                }
              />
            )}
            {detail?.market?.want != null && (
              <MetaChip label="wanted by" value={detail.market.want.toLocaleString()} />
            )}
          </div>
        </div>
      </header>

      {/* ---- half switch ---- */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-4 py-2 lg:static">
        <div className="flex rounded-md border border-ink-700 p-0.5">
          <button
            type="button"
            onClick={() => setHalf("crate")}
            className={`rounded px-3 py-1 text-xs transition-colors ${
              half === "crate" ? "bg-accent/15 font-medium text-accent" : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            In your crate
          </button>
          <button
            type="button"
            onClick={startBeyond}
            className={`flex items-center gap-1 rounded px-3 py-1 text-xs transition-colors ${
              half === "beyond" ? "bg-accent/15 font-medium text-accent" : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            <Sparkle className="h-3 w-3" />
            Beyond your crate
          </button>
        </div>

        {half === "beyond" && beyond && (
          <button
            type="button"
            onClick={() => {
              if (!digSeed) return;
              void runDig(digSeed, { page: nextDigPage(digPage) ?? 1 });
            }}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-400 hover:text-neutral-100 disabled:opacity-40"
            title="Fresh results — nothing you have already been shown"
          >
            <Shuffle className="h-3 w-3" />
            Dig again
          </button>
        )}

        {half === "crate" && localLanes.length > 0 && (
          <span className="ml-auto text-[11px] text-neutral-600">
            {localLanes.reduce((n, l) => n + l.results.length, 0).toLocaleString()} connected clips you own
          </span>
        )}
      </div>

      {/* ---- body ---- */}
      <div className="shrink-0 py-3 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
        {/*
          The record comes first, on both halves: when something grabs you on
          shuffle, the first thing you want is the rest of it. Everything
          below — more by the artist, the label, what mixes with it — is the
          second thing.
        */}
        <RecordSection
          order={record}
          releaseTitle={seed.releaseTitle}
          year={seed.year}
          onPlay={(index) =>
            onPlayRecord(recordQueue(record), index, seed.releaseTitle || "this record")
          }
          onPlayExtra={(item) => onPlayRecord([item], 0, seed.releaseTitle || "this record")}
        />

        {half === "crate" ? (
          localLanes.length === 0 ? (
            <p className="p-8 text-center text-xs text-neutral-600">
              Nothing else in your crate connects to this one. Try{" "}
              <button type="button" onClick={startBeyond} className="text-accent underline-offset-2 hover:underline">
                digging beyond it
              </button>
              .
            </p>
          ) : (
            <div className="space-y-4">
              {localLanes.map((lane) => {
                const shown = visibleCount(revealed[lane.key], lane.results.length);
                const more = shown < lane.results.length;
                return (
                <Lane
                  key={lane.key}
                  title={lane.label}
                  subtitle={lane.pivot}
                  count={lane.results.length > 1 ? `${shown} of ${lane.results.length}` : undefined}
                  end={
                    more ? (
                      <EndTile
                        title="More"
                        detail={`${lane.results.length - shown} more you own`}
                        onClick={() =>
                          setRevealed((r) => ({ ...r, [lane.key]: revealMore(shown, lane.results.length) }))
                        }
                      />
                    ) : (
                      <EndTile
                        title="Beyond your crate →"
                        detail="That's all you own here"
                        onClick={startBeyond}
                      />
                    )
                  }
                >
                  {lane.results.slice(0, shown).map((item, index) => (
                    <LocalRow
                      key={item.key}
                      item={item}
                      onPlay={() => onPlayLocal(lane.results, index)}
                      onAdd={() => onAddToPlaylist(item)}
                    />
                  ))}
                </Lane>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-4">
            {digSeed && digSeed.releaseId !== seed.releaseId && (
              <p className="px-4 text-[11px] text-neutral-500">
                Digging from <span className="text-accent">{digSeed.display}</span>
              </p>
            )}

            {loading && beyondLanes.length === 0 && (
              <div className="px-4">
                <p className="text-[11px] text-neutral-500">
                  Four lookups against Discogs — this artist&rsquo;s other records, this
                  label&rsquo;s catalogue, the style, and the same few years.
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mx-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                {error}
              </p>
            )}

            {beyondLanes.map((lane) => (
              <Lane
                key={lane.lane}
                title={lane.label}
                end={
                  dugOut ? (
                    <EndTile
                      title="Dug out"
                      detail="Tap the dig button on any record to start a new corner"
                    />
                  ) : (
                    <EndTile
                      title={loading ? "Digging…" : "Dig deeper →"}
                      detail="Next page from Discogs"
                      onClick={digDeeper}
                      disabled={loading}
                    />
                  )
                }
              >
                {lane.results.map((result) => (
                  <BeyondCard
                    key={`${lane.lane}:${result.releaseId}`}
                    result={{ ...result, market: marketByRelease[result.releaseId] ?? result.market }}
                    wanted={wantlistIds.has(result.releaseId)}
                    busy={busyRelease === result.releaseId}
                    previewState={previewStates[result.releaseId] ?? "idle"}
                    onPreview={() => void preview(result.releaseId)}
                    onWant={() => void toggleWant(result.releaseId)}
                    onDigFrom={() => digFrom(result)}
                  />
                ))}
              </Lane>
            ))}

            {!loading && beyond === null && !error && (
              <p className="p-8 text-center text-xs text-neutral-600">
                Loading the first dig…
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="hidden shrink-0 border-t border-ink-800 px-4 py-2 text-[10px] leading-relaxed text-neutral-600 lg:block">
        Every chip above is Discogs metadata from this release, and every record
        beyond your crate is a real Discogs id reached by a real relationship —
        this artist, this label, this style, this era. Preview plays the audio
        Discogs has linked; the heart writes to your actual Discogs wantlist.
      </footer>
    </div>
  );
}
