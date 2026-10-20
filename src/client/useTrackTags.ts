"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, trackTagsApi } from "@/client/api";
import { coalesce, serialWrites, type SerialWriter } from "@/client/serialWrites";
import { normaliseTag, normaliseTags, rankTags, sortTags, TAGS_PER_TRACK } from "@/lib/tags";

/**
 * Your tags, for the whole app: read once when it opens, changed one track at
 * a time from the player, the phone's player sheet and the record card, or a
 * whole selection at once from the selection bar.
 *
 * Optimistic, like BPMs: a tag shows the moment you add it. Saves go out one
 * at a time per track (serialWrites), so quick edits can't arrive out of
 * order; a selection's saves go through the same queue, gathered into a few
 * requests (coalesce). If a save fails, the track goes back to what the
 * server last said and the reason is shown.
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
  /**
   * Add one tag to every one of these tracks. Says what happened, or null
   * when tags haven't loaded yet or the tag isn't one that can be stored.
   */
  addToMany: (clipKeys: readonly string[], tag: string) => BulkTagResult | null;
}

export interface BulkTagResult {
  /** The tag as stored. */
  tag: string;
  /** Tracks that gained it. */
  tagged: number;
  /** Tracks that already had it. */
  already: number;
  /** Tracks already at the most tags one track can have. */
  full: number;
}

/** Most tracks in one request; matches the route's TRACK_TAGS_BATCH_MAX. */
const BATCH = 200;

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
   * The same map, readable outside a render: a selection's tag is worked out
   * from what each track carries right now, including edits a moment ago
   * that haven't rendered yet. Every change goes through `apply`, which
   * keeps the two the same.
   */
  const current = useRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const apply = useCallback(
    (update: (map: ReadonlyMap<string, readonly string[]>) => ReadonlyMap<string, readonly string[]>) => {
      current.current = update(current.current);
      setByKey(current.current);
    },
    [],
  );
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
  /** A failed batch fails every track in it; say why once, not once a track. */
  const lastSaid = useRef({ message: "", at: 0 });

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
          apply(() => server);
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
  }, [apply]);

  /*
   * Answers from a batch arrive a couple of hundred at once. Copying the
   * whole map once per track would be a few million inserts for a big
   * collection, so what they say is gathered and laid on in one go.
   */
  const staged = useRef(new Map<string, readonly string[]>());
  const stage = useCallback(
    (key: string, tags: readonly string[]) => {
      if (staged.current.size === 0) {
        queueMicrotask(() => {
          const changes = staged.current;
          staged.current = new Map();
          apply((map) => {
            const next = new Map(map);
            for (const [k, t] of changes) {
              if (t.length > 0) next.set(k, t);
              else next.delete(k);
            }
            return next;
          });
        });
      }
      staged.current.set(key, tags);
    },
    [apply],
  );

  /** Made on the first save, not during render: it holds the refs above. */
  const writer = useRef<SerialWriter<readonly string[]> | null>(null);
  const write = useCallback(
    (key: string, tags: readonly string[]) => {
      writer.current ??= serialWrites<readonly string[], readonly string[]>(
        coalesce<readonly string[], readonly string[]>(
          (clipKey, value) => trackTagsApi.set(clipKey, value).then((r) => r.tags),
          (batch) =>
            trackTagsApi
              .setMany(batch.map(([clipKey, value]) => ({ clipKey, tags: value })))
              .then((entries) => new Map(entries.map((e) => [e.clipKey, e.tags]))),
          BATCH,
        ),
        {
          onSaved: (clipKey, stored, settled) => {
            const saved = sortTags(stored);
            confirmed.current.set(clipKey, saved);
            // The server's form is the stored one; show it unless a newer
            // edit is already on its way.
            if (settled) stage(clipKey, saved);
          },
          onFailed: (clipKey, error, settled) => {
            if (!settled) return;
            stage(clipKey, confirmed.current.get(clipKey) ?? NONE);
            const message =
              error instanceof ApiError && error.status < 500
                ? error.message
                : "Couldn't save that tag — it's back to how it was.";
            const now = Date.now();
            if (message === lastSaid.current.message && now - lastSaid.current.at < 2_000) return;
            lastSaid.current = { message, at: now };
            say.current(message);
          },
        },
      );
      writer.current.write(key, tags);
    },
    [stage],
  );

  const set = useCallback(
    (key: string, tags: readonly string[]) => {
      if (!readyRef.current) return;
      const clean = normaliseTags(tags);
      // The editor checks before it calls; anything else isn't sent.
      if (!clean.ok) return;
      apply((map) => withKey(map, key, clean.tags));
      write(key, clean.tags);
    },
    [apply, write],
  );

  const addToMany = useCallback(
    (keys: readonly string[], raw: string): BulkTagResult | null => {
      if (!readyRef.current) return null;
      const one = normaliseTag(raw);
      if (!one.ok) return null;
      const tag = one.tag;
      let already = 0;
      let full = 0;
      const changes: Array<[string, string[]]> = [];
      for (const key of new Set(keys)) {
        const has = current.current.get(key) ?? NONE;
        if (has.includes(tag)) already += 1;
        else if (has.length >= TAGS_PER_TRACK) full += 1;
        else changes.push([key, sortTags([...has, tag])]);
      }
      if (changes.length > 0) {
        apply((map) => {
          const next = new Map(map);
          for (const [key, tags] of changes) next.set(key, tags);
          return next;
        });
        for (const [key, tags] of changes) write(key, tags);
      }
      return { tag, tagged: changes.length, already, full };
    },
    [apply, write],
  );

  const ranked = useMemo(() => rankTags(byKey), [byKey]);

  return { byKey, ranked, ready, set, addToMany };
}
