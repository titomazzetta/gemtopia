"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Playable, ReleaseDetail } from "@/lib/types";
import type { SearchHit } from "@/lib/discogs";
import {
  SURE_SCORE,
  ownershipLabel,
  rankCandidates,
  readFromBarcode,
  searchesFor,
  type SleeveCandidate,
  type SleeveRead,
} from "@/lib/sleeve";
import { ApiError, discogsSearchApi, releasesApi, scanApi } from "@/client/api";
import { prepareImage, readBarcodeHere, releaseImage, type PreparedImage } from "@/client/sleeveImage";
import { searchRecord } from "@/client/searchPlay";
import { recordTracks } from "@/client/recordOrder";
import { CameraIcon, InCollection, NoPreview, Play, Plus } from "./Icons";

/**
 * Scan records: photos in, a card per record out, then one add.
 *
 * The moment: you're at the shelves with the set half-pulled, or digging in
 * a shop, and typing is the slow part. Photograph the barcode, the centre
 * label or the sleeve — one, or a stack — and each photo becomes a card that
 * says what it found and why ("Barcode matches", "Cat # KDJ 44", "Reads like
 * this record"), whether you own it, and its tracklist with every track
 * ticked. Tick off what you don't want, then one button puts them all in
 * the set in photo order. A record you don't own can go to your collection
 * or wantlist from its card instead.
 *
 * Where the photo goes: nowhere, when the browser can read the barcode
 * itself. Otherwise, once, to the reader (/api/scan → the model), as a
 * re-encoded JPEG with no camera metadata, and it is kept nowhere. The
 * tracklist and the matching come from Discogs and lib/sleeve.ts, never
 * from the model.
 */

type Stage = "preparing" | "reading" | "searching" | "loading" | "done" | "unread" | "nothing" | "failed";

interface ScanItem {
  id: string;
  name: string;
  image: PreparedImage | null;
  stage: Stage;
  read: SleeveRead | null;
  /** The search that found the candidates: "Barcode 5020…". */
  searchSays: string | null;
  candidates: SleeveCandidate<SearchHit>[];
  pick: number;
  detail: ReleaseDetail | "loading" | "failed" | null;
  /** Clip keys left ticked; null means all of them. */
  unticked: Set<string>;
  /** What this card did on its own: joined your collection or wantlist. */
  added: "collection" | "wantlist" | null;
  error: string | null;
}

export type ScanTargetKind = "playlist" | "collection" | "wantlist";
const TARGET_KEY = "gt_scan_target_v1";

function rememberedTarget(): ScanTargetKind {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    return v === "collection" || v === "wantlist" ? v : "playlist";
  } catch {
    return "playlist";
  }
}

const metaLine = (hit: SearchHit) =>
  [hit.year ?? null, hit.catno, hit.labels[0] ?? null, hit.country, hit.formats[0] ?? null].filter(Boolean).join(" · ");

export function ScanSheet({
  files,
  sets,
  localDetail,
  targetName,
  onAddTracks,
  onAddToCollection,
  onAddToWantlist,
  onSearchInstead,
  onClose,
}: {
  files: File[];
  sets: { collection: Set<number>; wantlist: Set<number> };
  /** A release this device already holds, so no request is needed for its tracklist. */
  localDetail: (releaseId: number) => ReleaseDetail | null;
  /** The set one tap adds to, or null when the picker will ask. */
  targetName: string | null;
  /** Ticked tracks, in photo order, into a set: one tap or the picker. */
  onAddTracks: (items: Playable[], about: string, choose: boolean) => void;
  onAddToCollection: (hit: SearchHit) => Promise<void>;
  onAddToWantlist: (hit: SearchHit) => Promise<void>;
  /** Give up on a photo and search by hand with what was read. */
  onSearchInstead: (query: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ScanItem[]>(() =>
    files.map((file, i) => ({
      id: `${i}-${file.name}-${file.size}`,
      name: file.name,
      image: null,
      stage: "preparing",
      read: null,
      searchSays: null,
      candidates: [],
      pick: 0,
      detail: null,
      unticked: new Set(),
      added: null,
      error: null,
    })),
  );
  const [targetKind, setTargetKind] = useState<ScanTargetKind>(rememberedTarget);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);

  const update = useCallback((id: string, patch: Partial<ScanItem> | ((item: ScanItem) => Partial<ScanItem>)) => {
    setItems((list) =>
      list.map((item) => (item.id === id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item)),
    );
  }, []);

  // Close on Esc, focus the close button, keep the page from scrolling under.
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    try {
      localStorage.setItem(TARGET_KEY, targetKind);
    } catch {
      /* a private window: the choice lasts the session */
    }
  }, [targetKind]);

  /** The tracklist for a card's picked candidate: yours from the device, else one fetch. */
  const loadDetail = useCallback(
    async (id: string, releaseId: number) => {
      const local = localDetail(releaseId);
      if (local) {
        update(id, { detail: local, stage: "done" });
        return;
      }
      update(id, { detail: "loading", stage: "loading" });
      try {
        const { results } = await releasesApi.detail([releaseId]);
        const found = results.find((r) => r.id === releaseId);
        if (!alive.current) return;
        update(id, { detail: found?.ok ? found.release : "failed", stage: "done" });
      } catch {
        if (alive.current) update(id, { detail: "failed", stage: "done" });
      }
    },
    [localDetail, update],
  );

  /*
   * One photo at a time, in order: prepare, read (the browser's barcode
   * reader first, then the model), search Discogs most-exact-first, rank,
   * load the top candidate's tracklist. Sequential on purpose — the reader
   * and the search are both rate limited, and a stack of ten photos is still
   * done in well under a minute.
   */
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      for (const [i, file] of files.entries()) {
        if (cancelled) return;
        const id = items[i]?.id;
        if (!id) continue;
        let image: PreparedImage | null = null;
        try {
          image = await prepareImage(file);
        } catch {
          update(id, { stage: "failed", error: "That file isn't a photo this browser can open." });
          continue;
        }
        if (cancelled) {
          releaseImage(image);
          return;
        }
        update(id, { image, stage: "reading" });

        let read: SleeveRead | null = null;
        const code = await readBarcodeHere(image.bitmap);
        if (code) read = readFromBarcode(code);
        if (!read) {
          try {
            const answer = await scanApi.read({ image: image.base64, mime: "image/jpeg" });
            read = answer.read;
          } catch (error) {
            if (cancelled) return;
            const message =
              error instanceof ApiError
                ? error.status === 503
                  ? "Reading sleeves isn't set up here — the barcode still works in Chrome."
                  : error.message
                : "Couldn't reach the reader.";
            update(id, { stage: "failed", error: message });
            continue;
          }
        }
        if (cancelled) return;
        if (!read) {
          update(id, { stage: "unread" });
          continue;
        }
        update(id, { read, stage: "searching" });

        let candidates: SleeveCandidate<SearchHit>[] = [];
        let says: string | null = null;
        for (const search of searchesFor(read)) {
          try {
            const { results } = await discogsSearchApi.search(search.params);
            if (cancelled) return;
            if (results.length > 0) {
              candidates = rankCandidates(read, results, search.by, sets);
              says = search.says;
              break;
            }
          } catch (error) {
            if (cancelled) return;
            if (error instanceof ApiError && error.status === 429) {
              update(id, { stage: "failed", error: "Discogs is rate limiting — give it a minute and scan again." });
              break;
            }
          }
        }
        if (cancelled) return;
        if (candidates.length === 0) {
          update(id, (item) => (item.stage === "failed" ? {} : { stage: "nothing", searchSays: says }));
          continue;
        }
        update(id, { candidates, searchSays: says, pick: 0 });
        await loadDetail(id, candidates[0]!.hit.id);
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
    // Runs once for the files this sheet was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thumbnails go when the sheet does.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const item of itemsRef.current) if (item.image) releaseImage(item.image);
    },
    [],
  );

  const pickCandidate = (item: ScanItem, index: number) => {
    const candidate = item.candidates[index];
    if (!candidate) return;
    update(item.id, { pick: index, detail: null, unticked: new Set(), added: null });
    void loadDetail(item.id, candidate.hit.id);
  };

  /** A card's tracks, ticked ones only, in running order. */
  const tracksOf = (item: ScanItem): Playable[] => {
    if (!item.detail || item.detail === "loading" || item.detail === "failed") return [];
    const record = searchRecord(item.detail);
    if (!record) return [];
    return recordTracks(record.order).filter((t) => !item.unticked.has(t.key));
  };

  const ready = items.filter((item) => item.stage === "done" && item.candidates[item.pick]);
  const allTracks = useMemo(() => ready.flatMap(tracksOf), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const notOwned = ready.filter((item) => item.candidates[item.pick]!.ownership !== "collection" && item.added !== "collection");
  const notWanted = ready.filter(
    (item) => item.candidates[item.pick]!.ownership === "none" && item.added === null,
  );
  const working = items.some((item) => !["done", "unread", "nothing", "failed"].includes(item.stage));

  const addRecords = async (kind: "collection" | "wantlist", targets: ScanItem[]) => {
    setBusy(true);
    setNote(null);
    let done = 0;
    for (const item of targets) {
      const hit = item.candidates[item.pick]!.hit;
      try {
        if (kind === "collection") await onAddToCollection(hit);
        else await onAddToWantlist(hit);
        update(item.id, { added: kind });
        done += 1;
      } catch (error) {
        update(item.id, { error: error instanceof ApiError ? error.message : "That didn't save." });
      }
    }
    setBusy(false);
    setNote(
      done === 0
        ? "Nothing was added."
        : `Added ${done} ${done === 1 ? "record" : "records"} to your ${kind}${done < targets.length ? ` · ${targets.length - done} didn't save` : ""}`,
    );
  };

  const primary = (() => {
    if (targetKind === "collection") {
      const n = notOwned.length;
      return {
        label: n === 0 ? "All of these are in your collection" : `Add ${n} ${n === 1 ? "record" : "records"} to your collection`,
        disabled: n === 0 || busy,
        run: () => void addRecords("collection", notOwned),
      };
    }
    if (targetKind === "wantlist") {
      const n = notWanted.length;
      return {
        label: n === 0 ? "Nothing to want here" : `Add ${n} ${n === 1 ? "record" : "records"} to your wantlist`,
        disabled: n === 0 || busy,
        run: () => void addRecords("wantlist", notWanted),
      };
    }
    const n = allTracks.length;
    return {
      label:
        n === 0
          ? "No tracks ticked"
          : `Add ${n} ${n === 1 ? "track" : "tracks"} to ${targetName ?? "a playlist"}${targetName ? "" : "…"}`,
      disabled: n === 0 || busy,
      run: () => {
        const about = `${allTracks.length} tracks from ${ready.length} ${ready.length === 1 ? "record" : "records"} you scanned`;
        onAddTracks(allTracks, about, !targetName);
      },
    };
  })();

  return (
    <div
      className="fixed inset-0 z-60 flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Scan records"
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:h-auto lg:max-h-[90vh] lg:max-w-2xl lg:rounded-xl lg:border lg:border-ink-700">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <CameraIcon className="h-3 w-3" />
              Scan records
            </p>
            <h2 className="text-base font-semibold text-neutral-100">
              {files.length === 1 ? "One photo" : `${files.length} photos`}
              <span className="font-normal text-neutral-500">
                {" "}
                · {working ? "reading…" : `${ready.length} found`}
              </span>
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-700 text-lg text-neutral-300 hover:border-ink-600 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <ol className="space-y-3">
            {items.map((item, index) => {
              const candidate = item.candidates[item.pick] ?? null;
              const hit = candidate?.hit ?? null;
              const sure = candidate ? candidate.score >= SURE_SCORE : false;
              const owned = candidate?.ownership === "collection" || item.added === "collection";
              const wanted = candidate?.ownership === "wantlist" || item.added === "wantlist";
              const record = item.detail && item.detail !== "loading" && item.detail !== "failed" ? searchRecord(item.detail) : null;
              const tracks = record ? recordTracks(record.order) : [];
              return (
                <li key={item.id} className="rounded-lg border border-ink-800 bg-ink-900/60" aria-label={`Photo ${index + 1}`}>
                  <div className="flex gap-3 p-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-ink-850">
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image.url} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      {hit ? (
                        <>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            {sure ? "Is it this one?" : "Could be this one"}
                            {item.candidates.length > 1 && (
                              <span className="font-normal normal-case tracking-normal">
                                {" "}
                                · {item.pick + 1} of {item.candidates.length}
                              </span>
                            )}
                          </p>
                          <div className="mt-1 flex items-start gap-2">
                            {hit.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={hit.thumb}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="h-10 w-10 shrink-0 rounded-sm object-cover"
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-neutral-100">{hit.title}</p>
                              <p className="truncate text-[11px] text-neutral-400">{hit.artist}</p>
                              <p className="truncate font-mono text-[10px] text-neutral-600">{metaLine(hit)}</p>
                            </div>
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <span
                              className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium ${
                                owned ? "bg-accent/10 text-accent" : wanted ? "bg-accent-alt/10 text-accent-alt" : "bg-ink-800 text-neutral-400"
                              }`}
                            >
                              {owned && <InCollection className="h-2.5 w-2.5" />}
                              {item.added === "collection"
                                ? "Added to your collection"
                                : item.added === "wantlist"
                                  ? "Added to your wantlist"
                                  : ownershipLabel(candidate!.ownership)}
                            </span>
                            <span className="text-neutral-500">{candidate!.reason}</span>
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-neutral-400">
                          {item.stage === "preparing" || item.stage === "reading"
                            ? "Reading the sleeve…"
                            : item.stage === "searching"
                              ? "Searching Discogs…"
                              : item.stage === "unread"
                                ? "Couldn't read this one. Try the barcode on the back, or the centre label, in good light."
                                : item.stage === "nothing"
                                  ? "Nothing on Discogs matched what was read."
                                  : (item.error ?? "That didn't work.")}
                        </p>
                      )}
                      {item.read && (item.stage === "nothing" || item.stage === "failed" || (hit && !sure)) && (
                        <p className="mt-1 text-[11px] text-neutral-500">
                          Read:{" "}
                          {[item.read.artist, item.read.title, item.read.label, item.read.catno, item.read.barcode]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {item.error && hit && <p className="mt-1 text-[11px] text-red-300">{item.error}</p>}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.candidates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => pickCandidate(item, (item.pick + 1) % item.candidates.length)}
                            className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:border-accent/50 hover:text-accent"
                          >
                            Not it — next match
                          </button>
                        )}
                        {hit && !owned && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void addRecords("collection", [item])}
                            className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:border-accent/50 hover:text-accent disabled:opacity-50"
                          >
                            Add to collection
                          </button>
                        )}
                        {hit && !owned && !wanted && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void addRecords("wantlist", [item])}
                            className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:border-accent-alt/50 hover:text-accent-alt disabled:opacity-50"
                          >
                            Add to wantlist
                          </button>
                        )}
                        {(item.stage === "nothing" || (item.stage === "failed" && item.read)) && item.read && (
                          <button
                            type="button"
                            onClick={() =>
                              onSearchInstead(
                                [item.read?.artist, item.read?.title].filter(Boolean).join(" ") || item.read?.catno || "",
                              )
                            }
                            className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:border-accent/50 hover:text-accent"
                          >
                            Search by hand
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* The tracklist: every track ticked, untick what stays on the shelf. */}
                  {item.detail === "loading" && <p className="px-3 pb-3 text-[11px] text-neutral-600">Loading the tracklist…</p>}
                  {item.detail === "failed" && (
                    <p className="px-3 pb-3 text-[11px] text-neutral-500">Couldn&apos;t load the tracklist — the record can still go to your collection or wantlist.</p>
                  )}
                  {tracks.length > 0 && (
                    <ol className="border-t border-ink-800" aria-label={`Tracks on ${hit?.title ?? "this record"}`}>
                      {tracks.map((track) => {
                        const ticked = !item.unticked.has(track.key);
                        return (
                          <li key={track.key}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={ticked}
                              onClick={() =>
                                update(item.id, (current) => {
                                  const next = new Set(current.unticked);
                                  if (next.has(track.key)) next.delete(track.key);
                                  else next.add(track.key);
                                  return { unticked: next };
                                })
                              }
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-ink-800/60"
                            >
                              <span
                                className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border ${
                                  ticked ? "border-accent bg-accent text-ink-950" : "border-neutral-600 bg-ink-950/40"
                                }`}
                                aria-hidden="true"
                              >
                                {ticked && <InCollection className="h-2.5 w-2.5" />}
                              </span>
                              <span className="w-7 shrink-0 font-mono text-[10px] text-neutral-600">{track.position ?? ""}</span>
                              <span className={`min-w-0 flex-1 truncate ${ticked ? "text-neutral-200" : "text-neutral-500"}`}>{track.title}</span>
                              {track.silence === "record-only" ? (
                                <span className="flex shrink-0 items-center gap-1 text-[9px] text-neutral-600">
                                  <NoPreview className="h-3 w-3" />
                                  record only
                                </span>
                              ) : (
                                <Play className="h-3 w-3 shrink-0 text-neutral-500" aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
          <p role="status" className="text-xs text-accent [&:not(:empty)]:mt-3">
            {note}
          </p>
        </div>

        {/*
          Where it all goes. The last choice is remembered: scanning a stack
          into a set, or cataloguing a pile of new records into the
          collection, is the same tap every time.
        */}
        <footer className="shrink-0 border-t border-ink-800 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div role="group" aria-label="Add these to" className="mb-2 flex gap-1.5">
            {(
              [
                ["playlist", "Playlist"],
                ["collection", "Collection"],
                ["wantlist", "Wantlist"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={targetKind === kind}
                onClick={() => setTargetKind(kind)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  targetKind === kind ? "bg-accent text-ink-950" : "border border-ink-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={primary.disabled}
            onClick={primary.run}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-sm font-semibold text-ink-950 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {primary.label}
          </button>
        </footer>
      </div>
    </div>
  );
}
