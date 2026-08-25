"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Playable, Playlist, ReleaseDetail, Source, SyncState } from "@/lib/types";
import {
  deletePlaylist as dbDeletePlaylist,
  getAllDetails,
  getPlaylists,
  getSummaries,
  getSyncState,
  nuke,
  savePlaylist,
} from "@/client/db";
import { startSync, type SyncHandle } from "@/client/sync";
import { buildPlayables, spreadShuffle } from "@/client/playables";
import { useYouTubePlayer } from "@/client/useYouTubePlayer";
import { applyFilters, computeFacets, emptyFilters, Filters, type FilterState } from "./Filters";
import { NowPlaying } from "./NowPlaying";
import { PlaylistPanel } from "./PlaylistPanel";
import { TrackList } from "./TrackList";
import { Disc, Refresh, Shuffle } from "./Icons";

type Rail = "filters" | "playlists";

export function CrateApp({
  username,
  csrfToken,
}: {
  username: string;
  csrfToken: string;
}) {
  /* ---------------- data ---------------- */
  const [details, setDetails] = useState<ReleaseDetail[]>([]);
  const [sourceIds, setSourceIds] = useState<Record<Source, Set<number>>>({
    collection: new Set(),
    wantlist: new Set(),
  });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
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

  /* ---------------- playback ---------------- */
  const [queue, setQueue] = useState<Playable[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(true);
  const [repeatOn, setRepeatOn] = useState(true);

  const current = queue[queueIndex] ?? null;

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  }, []);

  /* ---------------- boot ---------------- */

  const reloadFromCache = useCallback(async () => {
    const [cachedDetails, collection, wantlist, savedPlaylists] = await Promise.all([
      getAllDetails(),
      getSummaries(username, "collection"),
      getSummaries(username, "wantlist"),
      getPlaylists(),
    ]);
    setDetails(cachedDetails);
    setSourceIds({
      collection: new Set(collection.map((s) => s.id)),
      wantlist: new Set(wantlist.map((s) => s.id)),
    });
    setPlaylists(savedPlaylists);
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
            void reloadFromCache();
          }
        },
      });
    },
    [username, reloadFromCache],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await reloadFromCache();
        const state = await getSyncState(username, "collection");
        if (cancelled) return;
        setSync(state);
        // Never synced, or interrupted last time: pick up where we left off.
        if (!state || state.status !== "done") runSync("collection");
      } catch (error) {
        console.error("[boot]", error);
        say("Could not open the local cache. Try a normal (non-private) window.");
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

  /* ---------------- derived ---------------- */

  const allPlayables = useMemo(() => buildPlayables(details), [details]);

  const byKey = useMemo(() => {
    const map = new Map<string, Playable>();
    for (const item of allPlayables) map.set(item.key, item);
    return map;
  }, [allPlayables]);

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

  const playlistItems = useMemo(() => {
    if (!activePlaylist) return [];
    return activePlaylist.items
      .map((key) => byKey.get(key))
      .filter((p): p is Playable => Boolean(p));
  }, [activePlaylist, byKey]);

  const visible = activePlaylist ? playlistItems : filtered;

  /* ---------------- player ---------------- */

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

  // Whenever the queue cursor moves, load that clip.
  const lastLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!api.ready || !current) return;
    if (lastLoaded.current === current.key) return;
    lastLoaded.current = current.key;
    api.load(current.videoId, true);
  }, [api, current]);

  const playFrom = useCallback(
    (items: Playable[], index: number) => {
      if (items.length === 0) return;
      setQueue(items);
      setQueueIndex(index);
      lastLoaded.current = null;
    },
    [],
  );

  const shuffleNow = useCallback(() => {
    const source_ = activePlaylist ? playlistItems : filtered;
    if (source_.length === 0) {
      say("Nothing to shuffle — loosen the filters.");
      return;
    }
    setShuffleOn(true);
    playFrom(spreadShuffle(source_), 0);
    say(`Shuffling ${source_.length.toLocaleString()} clips`);
  }, [activePlaylist, playlistItems, filtered, playFrom, say]);

  /* ---------------- playlists ---------------- */

  const persist = useCallback(async (playlist: Playlist) => {
    await savePlaylist(playlist);
    setPlaylists(await getPlaylists());
  }, []);

  const createPlaylist = useCallback(
    async (name: string, seed?: Playable) => {
      const playlist: Playlist = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: seed ? [seed.key] : [],
      };
      await persist(playlist);
      say(seed ? `Started "${name}" with ${seed.title}` : `Created "${name}"`);
      return playlist;
    },
    [persist, say],
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, item: Playable) => {
      const playlist = playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      if (playlist.items.includes(item.key)) {
        say(`Already in "${playlist.name}"`);
        return;
      }
      await persist({
        ...playlist,
        items: [...playlist.items, item.key],
        updatedAt: Date.now(),
      });
      say(`Added to "${playlist.name}"`);
    },
    [playlists, persist, say],
  );

  /** A on the keyboard, or the + on a row. */
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

  const reorderPlaylist = useCallback(
    async (from: number, to: number) => {
      if (!activePlaylist || from === to) return;
      const items = [...activePlaylist.items];
      const [moved] = items.splice(from, 1);
      if (!moved) return;
      items.splice(to, 0, moved);
      await persist({ ...activePlaylist, items, updatedAt: Date.now() });
    },
    [activePlaylist, persist],
  );

  const removeFromPlaylist = useCallback(
    async (index: number) => {
      if (!activePlaylist) return;
      const items = activePlaylist.items.filter((_, i) => i !== index);
      await persist({ ...activePlaylist, items, updatedAt: Date.now() });
    },
    [activePlaylist, persist],
  );

  const exportPlaylists = useCallback(() => {
    const payload = {
      app: "crateshuffle",
      version: 1,
      exportedAt: new Date().toISOString(),
      playlists,
      // Denormalise so an import on another machine can show titles even
      // before that machine has synced the same releases.
      tracks: playlists
        .flatMap((p) => p.items)
        .filter((key, i, all) => all.indexOf(key) === i)
        .map((key) => byKey.get(key))
        .filter(Boolean),
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
  }, [playlists, byKey]);

  const importPlaylists = useCallback(
    async (file: File) => {
      // Treat the file as hostile: cap the size, parse defensively, and accept
      // only the fields we understand rather than spreading unknown objects
      // into stored state.
      if (file.size > 5_000_000) {
        say("That file is too big to be a playlist export.");
        return;
      }

      try {
        const raw: unknown = JSON.parse(await file.text());
        if (
          typeof raw !== "object" ||
          raw === null ||
          !Array.isArray((raw as { playlists?: unknown }).playlists)
        ) {
          throw new Error("shape");
        }

        let imported = 0;
        for (const entry of (raw as { playlists: unknown[] }).playlists) {
          if (typeof entry !== "object" || entry === null) continue;
          const candidate = entry as Record<string, unknown>;
          const name = typeof candidate.name === "string" ? candidate.name.slice(0, 80) : null;
          const items = Array.isArray(candidate.items)
            ? candidate.items.filter(
                (k): k is string => typeof k === "string" && /^\d+:[A-Za-z0-9_-]{11}$/.test(k),
              )
            : [];
          if (!name) continue;

          await savePlaylist({
            id: crypto.randomUUID(),
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items,
          });
          imported += 1;
        }

        setPlaylists(await getPlaylists());
        say(imported > 0 ? `Imported ${imported} playlist(s)` : "Nothing importable in that file.");
      } catch {
        say("That does not look like a CrateShuffle export.");
      }
    },
    [say],
  );

  /* ---------------- auth ---------------- */

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    });
    await nuke();
    // Deliberate hard navigation: a client-side route change would keep the
    // in-memory queue, playlists and cached crate alive in this tab after we
    // have just wiped them from disk. Signing out should leave nothing behind.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }, [csrfToken]);

  /* ---------------- keyboard ---------------- */

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
        case "a":
          event.preventDefault();
          queueForPlaylist(current);
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
  }, [api, advance, shuffleNow, queueForPlaylist, current]);

  /* ---------------- render ---------------- */

  const syncing = sync?.status === "listing" || sync?.status === "detailing" || sync?.status === "paused";
  const progress =
    sync && sync.total > 0 ? Math.round((sync.detailed / sync.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
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
          <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-ink-700 bg-ink-850 p-1 shadow-xl">
            <button
              type="button"
              onClick={signOut}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-ink-800"
            >
              Sign out &amp; wipe cache
            </button>
          </div>
        </details>
      </header>

      {/* Sync strip */}
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

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left rail */}
        <nav className="flex shrink-0 flex-col border-b border-ink-800 bg-ink-900 lg:w-[280px] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 border-b border-ink-800">
            {(["filters", "playlists"] as const).map((value) => (
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

          <div className="min-h-[220px] flex-1 overflow-hidden lg:min-h-0">
            {rail === "filters" ? (
              <Filters
                facets={facets}
                filters={filters}
                onChange={setFilters}
                matched={filtered.length}
                total={pool.length}
              />
            ) : (
              <PlaylistPanel
                playlists={playlists}
                activeId={activePlaylistId}
                onSelect={setActivePlaylistId}
                onCreate={(name) => void createPlaylist(name)}
                onDelete={async (id) => {
                  await dbDeletePlaylist(id);
                  if (activePlaylistId === id) setActivePlaylistId(null);
                  setPlaylists(await getPlaylists());
                }}
                onRename={(id, name) => {
                  const playlist = playlists.find((p) => p.id === id);
                  if (playlist) void persist({ ...playlist, name, updatedAt: Date.now() });
                }}
                onPlay={(id, shuffled) => {
                  const playlist = playlists.find((p) => p.id === id);
                  if (!playlist) return;
                  const items = playlist.items
                    .map((key) => byKey.get(key))
                    .filter((p): p is Playable => Boolean(p));
                  if (items.length === 0) {
                    say("Those clips are not in the local cache yet.");
                    return;
                  }
                  setActivePlaylistId(id);
                  setShuffleOn(shuffled);
                  playFrom(shuffled ? spreadShuffle(items) : items, 0);
                }}
                onExport={exportPlaylists}
                onImport={(file) => void importPlaylists(file)}
              />
            )}
          </div>
        </nav>

        {/* List */}
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
                  activePlaylist ? (_item, index) => void removeFromPlaylist(index) : undefined
                }
                reorderable={Boolean(activePlaylist)}
                onReorder={(from, to) => void reorderPlaylist(from, to)}
                emptyMessage={
                  activePlaylist
                    ? "This playlist is empty. Add clips with the + button or the A key."
                    : syncing
                      ? "Still pulling your crate from Discogs…"
                      : pool.length === 0
                        ? `Nothing cached for your ${source} yet. Hit the refresh button to sync.`
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
          onToggleShuffle={shuffleNow}
          onToggleRepeat={() => setRepeatOn((v) => !v)}
          onPrev={() => (api.currentTime > 4 ? api.seek(0) : advance(-1))}
          onNext={() => advance(1)}
          onAddToPlaylist={() => queueForPlaylist(current)}
        />
      </div>

      {/* Playlist picker */}
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

      {/* Toast */}
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
