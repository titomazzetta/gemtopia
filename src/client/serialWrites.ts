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
