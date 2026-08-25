"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BpmSource,
  Playable,
  Playlist,
  PlaylistItemRow,
  ReleaseDetail,
  Source,
  SyncState,
  TrackMeta,
} from "@/lib/types";
import {
  clearLegacyPlaylists,
  getAllDetails,
  getLegacyPlaylists,
  getSummaries,
  getSyncState,
  isMigrated,
  markMigrated,
  nuke,
} from "@/client/db";
import {
  ApiError,
  insightsApi,
  playlistsApi,
  setCsrfToken,
  trackMetaApi,
  type InsightsResponse,
} from "@/client/api";
import { startSync, type SyncHandle } from "@/client/sync";
import { buildPlayables, spreadShuffle } from "@/client/playables";
import { TapTempo } from "@/client/tempo";
import { useTempoDetector } from "@/client/useTempoDetector";
import { useYouTubePlayer } from "@/client/useYouTubePlayer";
import {
  applyFilters,
  computeFacets,
  emptyFilters,
  Filters,
  type FilterState,
} from "./Filters";
import { InsightsPanel } from "./InsightsPanel";
import { NowPlaying } from "./NowPlaying";
import { PlaylistPanel } from "./PlaylistPanel";
import { TrackList } from "./TrackList";
import { Disc, Refresh, Shuffle } from "./Icons";

type Rail = "filters" | "playlists" | "insights";

type NewEntry = Omit<PlaylistItemRow, "position">;

/** A playable becomes a stored entry. Position comes from array order. */
function toEntry(item: Playable): NewEntry {
  return {
    clipKey: item.key,
    releaseId: item.releaseId,
    videoId: item.videoId,
    title: item.title.slice(0, 400),
    artist: item.artist.slice(0, 400),
    releaseTitle: item.releaseTitle.slice(0, 400),
    year: item.year,
  };
}

/** An already-stored row, ready to send back. */
function reEntry(row: PlaylistItemRow): NewEntry {
  return {
    clipKey: row.clipKey,
    releaseId: row.releaseId,
    videoId: row.videoId,
    title: row.title,
    artist: row.artist,
    releaseTitle: row.releaseTitle,
    year: row.year,
  };
}

export function CrateApp({
  username,
  csrfToken,
}: {
  username: string;
  csrfToken: string;
}) {
  setCsrfToken(csrfToken);

  /* ---------------- data ---------------- */
  const [details, setDetails] = useState<ReleaseDetail[]>([]);
  const [sourceIds, setSourceIds] = useState<Record<Source, Set<number>>>({
    collection: new Set(),
    wantlist: new Set(),
  });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [trackMeta, setTrackMeta] = useState<Map<string, TrackMeta>>(new Map());
  const [source, setSource] = useState<Source>("collection");
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const syncRef = useRef<SyncHandle | null>(null);

  /* ---------------- view ---------------- */
  const [rail, setRail] = useState<Rail>("filters");
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picker, setPicker] = useState<Playable | null>(null);

  /* ---------------- insights ---------------- */
  const [insights, setInsights] = useState<Record<string, InsightsResponse>>({});
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  /* ---------------- playback ---------------- */
  const [queue, setQueue] = useState<Playable[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(true);
  const [repeatOn, setRepeatOn] = useState(true);

  const current = queue[queueIndex] ?? null;

  // Mirrored into a ref so keyboard handlers and the tempo detector's commit
  // callback can read the current track without being re-created on every
  // track change. Written in an effect, never during render.
  const currentRef = useRef<Playable | null>(null);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2800);
  }, []);

  /* ================= BPM catalogue ================= */

  const saveMeta = useCallback(
    async (entry: TrackMeta) => {
      // Optimistic: the DB has precedence rules that may reject the write
      // (a tap always beats an auto reading), so we reconcile on next load.
      setTrackMeta((previous) => {
        const next = new Map(previous);
        next.set(entry.clipKey, { ...previous.get(entry.clipKey), ...entry });
        return next;
      });
      try {
        await trackMetaApi.save([entry]);
      } catch (error) {
        console.warn("[bpm] save failed", error);
        if (error instanceof ApiError && error.status !== 429) {
          say("Could not save that BPM.");
        }
      }
    },
    [say],
  );

  const tapper = useRef(new TapTempo());
  const [tapCount, setTapCount] = useState(0);

  const handleTap = useCallback(() => {
    const item = currentRef.current;
    if (!item) return;

    const estimate = tapper.current.tap();
    setTapCount(tapper.current.count);
    if (!estimate) return;

    void saveMeta({
      clipKey: item.key,
      bpm: estimate.bpm,
      bpmSource: "tap",
      bpmConfidence: estimate.confidence,
      musicalKey: null,
      rating: null,
      cueNote: null,
    });
  }, [saveMeta]);

  const onDetectorCommit = useCallback(
    (estimate: { bpm: number; confidence: number }) => {
      const item = currentRef.current;
      if (!item) return;
      void saveMeta({
        clipKey: item.key,
        bpm: estimate.bpm,
        bpmSource: "auto",
        bpmConfidence: estimate.confidence,
        musicalKey: null,
        rating: null,
        cueNote: null,
      });
    },
    [saveMeta],
  );

  const detector = useTempoDetector({ onCommit: onDetectorCommit });

  const scaleBpm = useCallback(
    (factor: 0.5 | 2) => {
      const item = currentRef.current;
      if (!item) return;
      const existing = trackMeta.get(item.key)?.bpm ?? item.bpm;
      if (existing === null || existing === undefined) return;

      const scaled = Math.round(existing * factor * 10) / 10;
      if (scaled < 40 || scaled > 260) {
        say("That would land outside a sensible tempo range.");
        return;
      }
      void saveMeta({
        clipKey: item.key,
        bpm: scaled,
        // A deliberate correction is a manual reading — it must outrank
        // whatever the detector decides next time it hears this track.
        bpmSource: "manual",
        bpmConfidence: 1,
        musicalKey: null,
        rating: null,
        cueNote: null,
      });
    },
    [trackMeta, saveMeta, say],
  );

  const clearBpm = useCallback(() => {
    const item = currentRef.current;
    if (!item) return;
    setTrackMeta((previous) => {
      const next = new Map(previous);
      next.delete(item.key);
      return next;
    });
    say("BPM cleared locally — re-tap to store a new one.");
  }, [say]);

  /* ================= boot ================= */

  const reloadCache = useCallback(async () => {
    const [cachedDetails, collection, wantlist] = await Promise.all([
      getAllDetails(),
      getSummaries(username, "collection"),
      getSummaries(username, "wantlist"),
    ]);
    setDetails(cachedDetails);
    setSourceIds({
      collection: new Set(collection.map((s) => s.id)),
      wantlist: new Set(wantlist.map((s) => s.id)),
    });
  }, [username]);

  const runSync = useCallback(
    (target: Source, force = false) => {
      syncRef.current?.cancel();
      syncRef.current = startSync({
        owner: username,
        source: target,
        force,
        onProgress: (state) => {
          setSync(state);
          if (state.status === "done" || state.status === "detailing") {
            void reloadCache();
          }
        },
      });
    },
    [username, reloadCache],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await reloadCache();

        const [serverPlaylists, meta, state] = await Promise.all([
          playlistsApi.list().catch(() => [] as Playlist[]),
          trackMetaApi.list().catch(() => [] as TrackMeta[]),
          getSyncState(username, "collection"),
        ]);
        if (cancelled) return;

        setPlaylists(serverPlaylists);
        setTrackMeta(new Map(meta.map((m) => [m.clipKey, m])));
        setSync(state);

        // Lift v1's browser-local playlists into the account, once.
        if (!(await isMigrated(username))) {
          const legacy = await getLegacyPlaylists();
          if (legacy.length > 0) {
            const cached = await getAllDetails();
            const byKey = new Map(
              buildPlayables(cached).map((p) => [p.key, p] as const),
            );
            const payload = legacy
              .map((list) => ({
                name: list.name,
                entries: list.items
                  .map((key) => byKey.get(key))
                  .filter((p): p is Playable => Boolean(p))
                  .map(toEntry),
              }))
              .filter((list) => list.entries.length > 0);

            if (payload.length > 0) {
              const result = await playlistsApi.importAll(payload);
              if (!cancelled) {
                setPlaylists(result.playlists);
                say(`Moved ${result.imported} playlist(s) into your account.`);
              }
            }
            await clearLegacyPlaylists();
          }
          await markMigrated(username);
        }

        if (!state || state.status !== "done") runSync("collection");
      } catch (error) {
        console.error("[boot]", error);
        if (!cancelled) say("Could not open your crate. Try reloading.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      syncRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================= derived ================= */

  const bpmByClip = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, meta] of trackMeta) {
      if (meta.bpm !== null) map.set(key, meta.bpm);
    }
    return map;
  }, [trackMeta]);

  const allPlayables = useMemo(
    () => buildPlayables(details, bpmByClip),
    [details, bpmByClip],
  );

  const byKey = useMemo(() => {
    const map = new Map<string, Playable>();
    for (const item of allPlayables) map.set(item.key, item);
    return map;
  }, [allPlayables]);

  const detailById = useMemo(() => {
    const map = new Map<number, ReleaseDetail>();
    for (const detail of details) map.set(detail.id, detail);
    return map;
  }, [details]);

  const pool = useMemo(
    () => allPlayables.filter((p) => sourceIds[source].has(p.releaseId)),
    [allPlayables, sourceIds, source],
  );

  const facets = useMemo(() => computeFacets(pool), [pool]);
  const filtered = useMemo(() => applyFilters(pool, filters), [pool, filters]);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId],
  );

  /**
   * Playlist rows resolve through the local cache when possible (so they carry
   * artwork, styles and BPM), and fall back to the denormalised row stored on
   * the server when a release has not been synced on this device yet.
   */
  const playlistItems = useMemo(() => {
    if (!activePlaylist) return [];
    return activePlaylist.entries.map((entry): Playable => {
      const cached = byKey.get(entry.clipKey);
      if (cached) return cached;
      return {
        key: entry.clipKey,
        releaseId: entry.releaseId,
        videoId: entry.videoId,
        title: entry.title,
        artist: entry.artist,
        releaseTitle: entry.releaseTitle,
        year: entry.year,
        genres: [],
        styles: [],
        labels: [],
        thumb: "",
        country: null,
        formats: [],
        duration: null,
        position: null,
        bpm: bpmByClip.get(entry.clipKey) ?? null,
        matchKind: "release",
      };
    });
  }, [activePlaylist, byKey, bpmByClip]);

  const visible = activePlaylist ? playlistItems : filtered;

  const currentMeta = current ? trackMeta.get(current.key) ?? null : null;
  const currentBpm = currentMeta?.bpm ?? current?.bpm ?? null;

  /* ================= player ================= */

  const advance = useCallback(
    (delta: number) => {
      setQueueIndex((index) => {
        const next = index + delta;
        if (next < 0) return repeatOn && queue.length > 0 ? queue.length - 1 : 0;
        if (next >= queue.length) return repeatOn ? 0 : index;
        return next;
      });
    },
    [queue.length, repeatOn],
  );

  const { containerRef, api } = useYouTubePlayer({
    onEnded: () => advance(1),
    onUnplayable: () => window.setTimeout(() => advance(1), 900),
  });

  const lastLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!api.ready || !current) return;
    if (lastLoaded.current === current.key) return;
    lastLoaded.current = current.key;
    api.load(current.videoId, true);

    // New track: throw away the tempo evidence gathered for the previous one.
    detector.reset();
    tapper.current.reset();
    setTapCount(0);
  }, [api, current, detector]);

  const playFrom = useCallback((items: Playable[], index: number) => {
    if (items.length === 0) return;
    setQueue(items);
    setQueueIndex(index);
    lastLoaded.current = null;
  }, []);

  const shuffleNow = useCallback(() => {
    const scope = activePlaylist ? playlistItems : filtered;
    if (scope.length === 0) {
      say("Nothing to shuffle — loosen the filters.");
      return;
    }
    setShuffleOn(true);
    playFrom(spreadShuffle(scope), 0);
    say(`Shuffling ${scope.length.toLocaleString()} clips`);
  }, [activePlaylist, playlistItems, filtered, playFrom, say]);

  /* ================= playlists ================= */

  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await playlistsApi.list());
  }, []);

  const createPlaylist = useCallback(
    async (name: string, seed?: Playable) => {
      try {
        const playlist = await playlistsApi.create(
          name,
          seed ? [toEntry(seed)] : [],
        );
        setPlaylists((previous) => [playlist, ...previous]);
        say(seed ? `Started "${name}" with ${seed.title}` : `Created "${name}"`);
      } catch (error) {
        say(error instanceof ApiError ? error.message : "Could not create that.");
      }
    },
    [say],
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, item: Playable) => {
      const playlist = playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      if (playlist.items.includes(item.key)) {
        say(`Already in "${playlist.name}"`);
        return;
      }
      try {
        const updated = await playlistsApi.update(playlistId, {
          entries: [...playlist.entries.map(reEntry), toEntry(item)],
        });
        setPlaylists((previous) =>
          previous.map((p) => (p.id === updated.id ? updated : p)),
        );
        say(`Added to "${playlist.name}"`);
      } catch (error) {
        say(error instanceof ApiError ? error.message : "Could not add that.");
      }
    },
    [playlists, say],
  );

  const queueForPlaylist = useCallback(
    (item: Playable | null) => {
      if (!item) return;
      if (activePlaylist) {
        void addToPlaylist(activePlaylist.id, item);
        return;
      }
      if (playlists.length === 1) {
        void addToPlaylist(playlists[0]!.id, item);
        return;
      }
      setPicker(item);
    },
    [activePlaylist, playlists, addToPlaylist],
  );

  const mutateEntries = useCallback(
    async (playlist: Playlist, entries: NewEntry[]) => {
      try {
        const updated = await playlistsApi.update(playlist.id, { entries });
        setPlaylists((previous) =>
          previous.map((p) => (p.id === updated.id ? updated : p)),
        );
      } catch (error) {
        say(error instanceof ApiError ? error.message : "Could not save that.");
        void refreshPlaylists();
      }
    },
    [say, refreshPlaylists],
  );

  const reorderPlaylist = useCallback(
    (from: number, to: number) => {
      if (!activePlaylist || from === to) return;
      const entries = activePlaylist.entries.map(reEntry);
      const [moved] = entries.splice(from, 1);
      if (!moved) return;
      entries.splice(to, 0, moved);
      void mutateEntries(activePlaylist, entries);
    },
    [activePlaylist, mutateEntries],
  );

  const removeFromPlaylist = useCallback(
    (index: number) => {
      if (!activePlaylist) return;
      void mutateEntries(
        activePlaylist,
        activePlaylist.entries.filter((_, i) => i !== index).map(reEntry),
      );
    },
    [activePlaylist, mutateEntries],
  );

  const exportPlaylists = useCallback(() => {
    const payload = {
      app: "crateshuffle",
      version: 2,
      exportedAt: new Date().toISOString(),
      playlists: playlists.map((p) => ({
        name: p.name,
        entries: p.entries.map(reEntry),
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crateshuffle-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [playlists]);

  const importPlaylists = useCallback(
    async (file: File) => {
      // Treat the file as hostile: cap the size, and let the server's Zod
      // schema be the thing that decides what a valid entry looks like.
      if (file.size > 5_000_000) {
        say("That file is too big to be a playlist export.");
        return;
      }
      try {
        const raw: unknown = JSON.parse(await file.text());
        const lists = (raw as { playlists?: unknown })?.playlists;
        if (!Array.isArray(lists)) throw new Error("shape");

        const payload = lists
          .filter(
            (l): l is { name: string; entries: unknown[] } =>
              typeof l === "object" &&
              l !== null &&
              typeof (l as { name?: unknown }).name === "string",
          )
          .map((l) => ({
            name: String(l.name).slice(0, 80),
            entries: Array.isArray(l.entries)
              ? (l.entries as Omit<PlaylistItemRow, "position">[])
              : [],
          }));

        const result = await playlistsApi.importAll(payload);
        setPlaylists(result.playlists);
        say(`Imported ${result.imported} playlist(s)`);
      } catch (error) {
        say(
          error instanceof ApiError
            ? error.message
            : "That does not look like a CrateShuffle export.",
        );
      }
    },
    [say],
  );

  /* ================= insights ================= */

  const analyse = useCallback(
    async (refresh: boolean) => {
      if (!activePlaylist) return;
      setInsightsLoading(true);
      setInsightsError(null);

      try {
        // Seeds come from the local cache: the server would otherwise need one
        // Discogs request per release just to learn what it already knows.
        const seedIds = [
          ...new Set(activePlaylist.entries.map((e) => e.releaseId)),
        ];
        const seeds = seedIds
          .map((id) => detailById.get(id))
          .filter((d): d is ReleaseDetail => Boolean(d))
          .map((d) => ({
            releaseId: d.id,
            artistIds: d.artistIds,
            artistNames: d.artist.split(/,\s*|\s+&\s+/).slice(0, 24),
            labelIds: d.labelIds,
            labelNames: d.labels,
            styles: d.styles,
            genres: d.genres,
            country: d.country,
            year: d.year,
          }));

        const result = await insightsApi.analyse({
          playlistId: activePlaylist.id,
          refresh,
          seeds,
          ownedReleaseIds: [...sourceIds.collection],
          wantlistReleaseIds: [...sourceIds.wantlist],
        });

        setInsights((previous) => ({ ...previous, [activePlaylist.id]: result }));
      } catch (error) {
        setInsightsError(
          error instanceof ApiError ? error.message : "Analysis failed.",
        );
      } finally {
        setInsightsLoading(false);
      }
    },
    [activePlaylist, detailById, sourceIds],
  );

  /* ================= auth ================= */

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    });
    await nuke();
    // Deliberate hard navigation: a client-side route change would keep the
    // in-memory queue and cached crate alive in this tab after we have just
    // wiped them from disk.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }, [csrfToken]);

  /* ================= keyboard ================= */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          api.toggle();
          break;
        case "ArrowRight":
          event.preventDefault();
          advance(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          advance(-1);
          break;
        case "j":
          api.nudge(-10);
          break;
        case "l":
          api.nudge(10);
          break;
        case "s":
          shuffleNow();
          break;
        case "r":
          setRepeatOn((v) => !v);
          break;
        case "t":
          event.preventDefault();
          handleTap();
          break;
        case "a":
          event.preventDefault();
          queueForPlaylist(currentRef.current);
          break;
        case "/":
          event.preventDefault();
          setRail("filters");
          document.getElementById("crate-search")?.focus();
          break;
        case "Escape":
          setPicker(null);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [api, advance, shuffleNow, queueForPlaylist, handleTap]);

  /* ================= render ================= */

  const syncing =
    sync?.status === "listing" ||
    sync?.status === "detailing" ||
    sync?.status === "paused";
  const progress =
    sync && sync.total > 0 ? Math.round((sync.detailed / sync.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2.5">
        <Disc className="h-5 w-5 shrink-0 text-accent" />
        <span className="hidden text-sm font-semibold tracking-tight text-neutral-100 sm:block">
          CrateShuffle
        </span>

        <div className="ml-2 flex rounded-md border border-ink-700 p-0.5">
          {(["collection", "wantlist"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSource(value);
                setActivePlaylistId(null);
                void (async () => {
                  const state = await getSyncState(username, value);
                  setSync(state);
                  if (!state || state.status !== "done") runSync(value);
                })();
              }}
              className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                source === value
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-neutral-500 hover:text-neutral-200"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={shuffleNow}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950 transition-transform hover:scale-105"
          title="Shuffle what's on screen (S)"
        >
          <Shuffle className="h-3.5 w-3.5" />
          Shuffle
        </button>

        <button
          type="button"
          onClick={() => runSync(source, true)}
          disabled={syncing}
          title="Resync from Discogs"
          className="rounded-md border border-ink-700 p-1.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
        >
          <Refresh className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        </button>

        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-100">
            {username}
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-ink-700 bg-ink-850 p-1 shadow-xl">
            <button
              type="button"
              onClick={signOut}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-ink-800"
            >
              Sign out &amp; wipe local cache
            </button>
          </div>
        </details>
      </header>

      {sync && sync.status !== "done" && (
        <div className="shrink-0 border-b border-ink-800 bg-ink-850 px-4 py-1.5">
          <div className="flex items-center gap-3 text-[11px] text-neutral-400">
            <span className="truncate">{sync.message ?? "Syncing…"}</span>
            {sync.total > 0 && (
              <div className="ml-auto flex w-40 shrink-0 items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="font-mono tabular-nums">{progress}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav className="flex shrink-0 flex-col border-b border-ink-800 bg-ink-900 lg:w-[300px] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 border-b border-ink-800">
            {(["filters", "playlists", "insights"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRail(value)}
                className={`flex-1 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                  rail === value
                    ? "border-b-2 border-accent text-accent"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {value}
                {value === "playlists" && playlists.length > 0 && (
                  <span className="ml-1 text-neutral-600">{playlists.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="min-h-[240px] flex-1 overflow-hidden lg:min-h-0">
            {rail === "filters" && (
              <Filters
                facets={facets}
                filters={filters}
                onChange={setFilters}
                matched={filtered.length}
                total={pool.length}
                currentBpm={currentBpm}
              />
            )}

            {rail === "playlists" && (
              <PlaylistPanel
                playlists={playlists}
                activeId={activePlaylistId}
                onSelect={setActivePlaylistId}
                onCreate={(name) => void createPlaylist(name)}
                onDelete={async (id) => {
                  try {
                    await playlistsApi.remove(id);
                    if (activePlaylistId === id) setActivePlaylistId(null);
                    setPlaylists((previous) => previous.filter((p) => p.id !== id));
                  } catch {
                    say("Could not delete that playlist.");
                  }
                }}
                onRename={async (id, name) => {
                  try {
                    const updated = await playlistsApi.update(id, { name });
                    setPlaylists((previous) =>
                      previous.map((p) => (p.id === updated.id ? updated : p)),
                    );
                  } catch {
                    say("Could not rename that playlist.");
                  }
                }}
                onPlay={(id, shuffled) => {
                  const playlist = playlists.find((p) => p.id === id);
                  if (!playlist || playlist.entries.length === 0) {
                    say("That playlist is empty.");
                    return;
                  }
                  setActivePlaylistId(id);
                  setShuffleOn(shuffled);
                  const items = playlist.entries.map(
                    (entry) => byKey.get(entry.clipKey) ?? null,
                  );
                  const resolved = items.filter((p): p is Playable => Boolean(p));
                  if (resolved.length === 0) {
                    say("Those clips are not in the local cache yet.");
                    return;
                  }
                  playFrom(shuffled ? spreadShuffle(resolved) : resolved, 0);
                }}
                onExport={exportPlaylists}
                onImport={(file) => void importPlaylists(file)}
              />
            )}

            {rail === "insights" && (
              <InsightsPanel
                playlistName={activePlaylist?.name ?? null}
                data={activePlaylist ? insights[activePlaylist.id] ?? null : null}
                loading={insightsLoading}
                error={insightsError}
                onAnalyse={() => void analyse(false)}
                onRefresh={() => void analyse(true)}
              />
            )}
          </div>
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-4 py-2">
            <h2 className="text-xs font-medium text-neutral-300">
              {activePlaylist ? activePlaylist.name : `Your ${source}`}
            </h2>
            <span className="text-[11px] text-neutral-600">
              {visible.length.toLocaleString()} clips
            </span>
            {activePlaylist && (
              <button
                type="button"
                onClick={() => setActivePlaylistId(null)}
                className="ml-auto text-[11px] text-neutral-500 hover:text-neutral-200"
              >
                Back to crate
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-600">
                Opening your crate…
              </div>
            ) : (
              <TrackList
                items={visible}
                currentKey={current?.key ?? null}
                onPlay={(index) => playFrom(visible, index)}
                onAdd={activePlaylist ? undefined : (item) => queueForPlaylist(item)}
                onRemove={
                  activePlaylist ? (_item, index) => removeFromPlaylist(index) : undefined
                }
                reorderable={Boolean(activePlaylist)}
                onReorder={reorderPlaylist}
                emptyMessage={
                  activePlaylist
                    ? "This playlist is empty. Add clips with the + button or the A key."
                    : syncing
                      ? "Still pulling your crate from Discogs…"
                      : pool.length === 0
                        ? `Nothing cached for your ${source} yet. Hit refresh to sync.`
                        : "No clips match those filters."
                }
              />
            )}
          </div>
        </main>

        <NowPlaying
          containerRef={containerRef}
          api={api}
          current={current}
          queuePosition={queueIndex}
          queueLength={queue.length}
          shuffleOn={shuffleOn}
          repeatOn={repeatOn}
          tempo={{
            bpm: currentBpm,
            bpmSource: (currentMeta?.bpmSource ?? null) as BpmSource | null,
            liveBpm: detector.live?.bpm ?? null,
            liveConfidence: detector.live?.confidence ?? 0,
            detectorStatus: detector.status,
            detectorError: detector.error,
            tapCount,
            onTap: handleTap,
            onStartDetector: (kind) => void detector.start(kind),
            onStopDetector: detector.stop,
            onScaleBpm: scaleBpm,
            onClearBpm: clearBpm,
          }}
          onToggleShuffle={shuffleNow}
          onToggleRepeat={() => setRepeatOn((v) => !v)}
          onPrev={() => (api.currentTime > 4 ? api.seek(0) : advance(-1))}
          onNext={() => advance(1)}
          onAddToPlaylist={() => queueForPlaylist(currentRef.current)}
        />
      </div>

      {picker && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add to playlist"
          onClick={(e) => e.target === e.currentTarget && setPicker(null)}
        >
          <div className="w-full max-w-sm rounded-lg border border-ink-700 bg-ink-900 p-4">
            <h3 className="text-sm font-semibold text-neutral-100">Add to playlist</h3>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {picker.artist} — {picker.title}
            </p>

            <ul className="my-3 max-h-56 space-y-1 overflow-y-auto">
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void addToPlaylist(playlist.id, picker);
                      setPicker(null);
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-ink-800"
                  >
                    <span className="truncate">{playlist.name}</span>
                    <span className="ml-2 shrink-0 text-neutral-600">
                      {playlist.items.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem(
                  "name",
                ) as HTMLInputElement | null;
                const name = input?.value.trim();
                if (!name) return;
                void createPlaylist(name, picker);
                setPicker(null);
              }}
              className="flex gap-1.5 border-t border-ink-800 pt-3"
            >
              <input
                name="name"
                autoFocus
                maxLength={80}
                placeholder="…or a new playlist"
                className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs"
                aria-label="New playlist name"
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-accent px-3 text-xs font-semibold text-ink-950"
              >
                Create
              </button>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-ink-700 bg-ink-850/95 px-4 py-2 text-xs text-neutral-200 shadow-xl backdrop-blur"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
