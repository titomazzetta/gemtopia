"use client";

import { useCallback, useRef, useState } from "react";
import type { ReleaseDetail, Source, SyncState } from "@/lib/types";
import {
  getAllDetails,
  getSummaries,
  putDetails,
  putSummaries,
} from "@/client/db";
import { startSync, type SyncHandle } from "@/client/sync";
import { mergeDetail, summaryOf } from "@/client/adopt";

/**
 * The crate: what you own, when you got it, and how fresh that knowledge is.
 *
 * Lifted out of CrateApp, which was 2,400 lines holding six unrelated
 * concerns in one scope. The problem was never the line count — it was that
 * none of this could be reached by a test, so every bug in it had to be found
 * by reading. Four were, in one week.
 *
 * The split is deliberate: this hook owns the *state and its persistence*,
 * and the component owns *what to say about it*. So `adopt` writes IndexedDB
 * and updates the three pieces of state that have to move together, and the
 * caller decides whether that warrants a toast — because only the caller
 * knows whether the record it just added has anything to play.
 */
export interface CrateCache {
  /** Every release detail cached on this device, across both sources. */
  details: ReleaseDetail[];
  /** Release id -> when it entered the list. Only the collection and wantlist
   *  endpoints know this; a detail fetch always reports null. */
  addedAt: Map<number, string | null>;
  sourceIds: Record<Source, Set<number>>;
  sync: SyncState | null;
  loading: boolean;

  /** Re-read everything from IndexedDB into state. */
  reload: () => Promise<void>;
  /** Start (or restart) a background sync for one source. */
  runSync: (target: Source, force?: boolean) => void;
  /** Stop any sync in flight — for effect cleanup. */
  cancelSync: () => void;

  setSync: (state: SyncState | null) => void;
  setLoading: (value: boolean) => void;

  /**
   * A record just added to the collection, folded in where a sync would have
   * put it. Writes IndexedDB and moves details, addedAt and sourceIds
   * together — three pieces of state that are wrong apart.
   */
  adopt: (detail: ReleaseDetail, addedAtIso: string) => Promise<void>;
  /** The optimistic half: the POST landed, the detail fetch has not. */
  markCollected: (releaseId: number) => void;
  /** The heart, both directions. */
  markWanted: (releaseId: number, wanted: boolean) => void;
}

export function useCrateCache(username: string): CrateCache {
  const [details, setDetails] = useState<ReleaseDetail[]>([]);
  const [addedAt, setAddedAt] = useState<Map<number, string | null>>(new Map());
  const [sourceIds, setSourceIds] = useState<Record<Source, Set<number>>>({
    collection: new Set(),
    wantlist: new Set(),
  });
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);

  const syncRef = useRef<SyncHandle | null>(null);

  const reload = useCallback(async () => {
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
    setAddedAt(
      new Map(
        [...collection, ...wantlist].map((s) => [s.id, s.addedAt] as const),
      ),
    );
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
            void reload();
          }
        },
      });
    },
    [username, reload],
  );

  const cancelSync = useCallback(() => {
    syncRef.current?.cancel();
  }, []);

  const markCollected = useCallback((releaseId: number) => {
    setSourceIds((previous) => {
      const collection = new Set(previous.collection);
      collection.add(releaseId);
      return { ...previous, collection };
    });
  }, []);

  const markWanted = useCallback((releaseId: number, wanted: boolean) => {
    setSourceIds((previous) => {
      const wantlist = new Set(previous.wantlist);
      if (wanted) wantlist.add(releaseId);
      else wantlist.delete(releaseId);
      return { ...previous, wantlist };
    });
  }, []);

  const adopt = useCallback(
    async (detail: ReleaseDetail, addedAtIso: string) => {
      await Promise.all([
        putDetails([detail]),
        // Stamped here because this is the moment it happened; the release
        // endpoint reports null for every copy of every record.
        putSummaries(username, "collection", [summaryOf(detail, addedAtIso)]),
      ]);
      setDetails((previous) => mergeDetail(previous, detail));
      setAddedAt((previous) => new Map(previous).set(detail.id, addedAtIso));
    },
    [username],
  );

  return {
    details,
    addedAt,
    sourceIds,
    sync,
    loading,
    reload,
    runSync,
    cancelSync,
    setSync,
    setLoading,
    adopt,
    markCollected,
    markWanted,
  };
}
