/**
 * Saves that go one at a time per key, newest value last.
 *
 * Tagging is quick: "deep", then "opening", a second apart. Sent as they
 * come, two requests for one track can arrive in either order, and if the
 * older one lands last, the server ends up holding a set you had already
 * moved past. So a key never has two requests in flight: a value written
 * while one is out waits, a newer one replaces it while it waits, and only
 * what's newest is sent next. Different keys don't wait for each other.
 *
 * `settled` tells the caller whether this was the last word for its key:
 * when it's false a newer value is already on its way, and what's on screen
 * should be left alone.
 */
export interface SerialWriter<V> {
  write(key: string, value: V): void;
  /** Whether anything for `key` is in flight or waiting. */
  busy(key: string): boolean;
}

export function serialWrites<V, R>(
  send: (key: string, value: V) => Promise<R>,
  handlers: {
    onSaved: (key: string, result: R, settled: boolean) => void;
    onFailed: (key: string, error: unknown, settled: boolean) => void;
  },
): SerialWriter<V> {
  const waiting = new Map<string, V>();
  const inFlight = new Set<string>();

  const next = (key: string) => {
    if (!waiting.has(key)) return;
    const value = waiting.get(key) as V;
    waiting.delete(key);
    inFlight.add(key);
    send(key, value).then(
      (result) => {
        inFlight.delete(key);
        handlers.onSaved(key, result, !waiting.has(key));
        next(key);
      },
      (error: unknown) => {
        inFlight.delete(key);
        handlers.onFailed(key, error, !waiting.has(key));
        next(key);
      },
    );
  };

  return {
    write(key, value) {
      waiting.set(key, value);
      if (!inFlight.has(key)) next(key);
    },
    busy(key) {
      return inFlight.has(key) || waiting.has(key);
    },
  };
}

/**
 * Sends that start in the same moment go out as one request.
 *
 * Tagging a selection writes a few hundred tracks at once. Through
 * serialWrites each track still has at most one save in flight, newest last;
 * this sits underneath as its transport, and gathers every send that starts
 * in the same tick into requests of at most `max` tracks. A lone send — the
 * tag editor's one track — goes through `sendOne`, the request it always
 * used.
 *
 * One request at a time, in order: a few thousand ticked tracks are a queue
 * of batches, not a burst that would all wait on the same database lock and
 * hold a connection each while they did. If a request fails, the tracks in
 * it hear why, and so do the rest of that burst without being sent — the
 * same answer (over the account's limit, offline) would only come back again.
 * serialWrites puts each one back the way it would for one.
 */
export function coalesce<V, R>(
  sendOne: (key: string, value: V) => Promise<R>,
  sendMany: (batch: ReadonlyArray<readonly [string, V]>) => Promise<ReadonlyMap<string, R>>,
  max: number,
): (key: string, value: V) => Promise<R> {
  type Queued = { key: string; value: V; resolve: (result: R) => void; reject: (error: unknown) => void };
  let queued: Queued[] = [];
  /** The end of the line: every burst's requests go after the last one's. */
  let tail: Promise<void> = Promise.resolve();

  const send = async (chunk: Queued[]) => {
    if (chunk.length === 1) {
      const only = chunk[0] as Queued;
      only.resolve(await sendOne(only.key, only.value));
      return;
    }
    const results = await sendMany(chunk.map((q) => [q.key, q.value] as const));
    for (const q of chunk) {
      if (results.has(q.key)) q.resolve(results.get(q.key) as R);
      else q.reject(new Error("missing from the batch's answer"));
    }
  };

  const flush = () => {
    const all = queued;
    queued = [];
    const chunks: Queued[][] = [];
    for (let i = 0; i < all.length; i += max) chunks.push(all.slice(i, i + max));
    tail = tail.then(async () => {
      let failure: { error: unknown } | null = null;
      for (const chunk of chunks) {
        if (failure) {
          for (const q of chunk) q.reject(failure.error);
          continue;
        }
        try {
          await send(chunk);
        } catch (error) {
          failure = { error };
          for (const q of chunk) q.reject(error);
        }
      }
    });
  };

  return (key, value) =>
    new Promise<R>((resolve, reject) => {
      if (queued.length === 0) queueMicrotask(flush);
      queued.push({ key, value, resolve, reject });
    });
}
