"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, trackTagsApi } from "@/client/api";
import { serialWrites, type SerialWriter } from "@/client/serialWrites";
import { normaliseTags, rankTags, sortTags } from "@/lib/tags";

/**
 * Your tags, for the whole app: read once when it opens, changed one track at
 * a time from the player, the phone's player sheet and the record card.
 *
 * Optimistic, like BPMs: a tag shows the moment you add it. Saves go out one
 * at a time per track (serialWrites), so quick edits can't arrive out of
 * order; if a save fails, the track goes back to what the server last said
 * and the reason is shown.
 */
export interface TrackTags {
  /** Clip key → its tags, sorted. Only tracks that have some. */
  byKey: ReadonlyMap<string, readonly string[]>;
  /** Every tag you use, most-used first: the suggestions. */
  ranked: ReadonlyArray<readonly [string, number]>;
  /** The list has arrived: until it has, tags show nowhere and can't be edited. */
  ready: boolean;
  /** Make one track's tags exactly these. */
  set: (clipKey: string, tags: readonly string[]) => void;
}

const NONE: readonly string[] = [];

function withKey(
  map: ReadonlyMap<string, readonly string[]>,
  key: string,
  tags: readonly string[],
): Map<string, readonly string[]> {
  const next = new Map(map);
  if (tags.length > 0) next.set(key, tags);
  else next.delete(key);
  return next;
}

export function useTrackTags(onError: (message: string) => void): TrackTags {
  const [byKey, setByKey] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  /*
   * Nothing is editable until the list has arrived. A save replaces a
   * track's whole set, so tagging a track before knowing what it already
   * carries would quietly drop the tags it had.
   */
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  /** What the server last said, per track: where a failed save goes back to. */
  const confirmed = useRef(new Map<string, readonly string[]>());
  const say = useRef(onError);
  useEffect(() => {
    say.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;
    const load = (attempt: number) => {
      trackTagsApi
        .list()
        .then((entries) => {
          if (cancelled) return;
          const server = new Map<string, readonly string[]>();
          for (const entry of entries) {
            if (entry.tags.length > 0) server.set(entry.clipKey, sortTags(entry.tags));
          }
          confirmed.current = new Map(server);
          readyRef.current = true;
          setByKey(server);
          setReady(true);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn("[tags] list failed", error);
          // A blip shouldn't cost you your tags for the visit: try again,
          // a few times, further apart.
          const wait = [2_000, 8_000, 30_000][attempt];
          if (wait !== undefined) retry = window.setTimeout(() => load(attempt + 1), wait);
        });
    };
    load(0);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, []);

  /** Made on the first save, not during render: it holds the refs above. */
  const writer = useRef<SerialWriter<readonly string[]> | null>(null);

  const set = useCallback((key: string, tags: readonly string[]) => {
    if (!readyRef.current) return;
    const clean = normaliseTags(tags);
    // The editor checks before it calls; anything else isn't sent.
    if (!clean.ok) return;
    setByKey((map) => withKey(map, key, clean.tags));

    writer.current ??= serialWrites<readonly string[], { tags: string[] }>(
      (clipKey, value) => trackTagsApi.set(clipKey, value),
      {
        onSaved: (clipKey, result, settled) => {
          const saved = sortTags(result.tags);
          confirmed.current.set(clipKey, saved);
          // The server's form is the stored one; show it unless a newer
          // edit is already on its way.
          if (settled) setByKey((map) => withKey(map, clipKey, saved));
        },
        onFailed: (clipKey, error, settled) => {
          if (!settled) return;
          setByKey((map) => withKey(map, clipKey, confirmed.current.get(clipKey) ?? NONE));
          say.current(
            error instanceof ApiError && error.status < 500
              ? error.message
              : "Couldn't save that tag — it's back to how it was.",
          );
        },
      },
    );
    writer.current.write(key, clean.tags);
  }, []);

  const ranked = useMemo(() => rankTags(byKey), [byKey]);

  return { byKey, ranked, ready, set };
}
