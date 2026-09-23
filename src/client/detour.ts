/**
 * Leaving the shuffle to explore a record, and coming back.
 *
 * Playing the rest of an EP used to *replace* the queue: once you had heard
 * the B-side there was no way back to the shuffle you were in, short of
 * starting a new one and losing your place in the crate. A detour remembers
 * where you left and returns you there — when the record runs out, or the
 * moment you press Back.
 *
 * Deliberately small. One saved position, not a stack: dig from the record
 * into a second record and back still returns you to the *shuffle*, which is
 * where you actually were, not to the first record you wandered into.
 */

export interface Detour<T> {
  /** The queue you left, and where in it. */
  queue: T[];
  index: number;
  /** What you went to explore, for the "exploring …" banner. */
  label: string;
}

/**
 * Start a detour, or move within one.
 *
 * If you are already exploring, the saved position does not change — only
 * the label does. Overwriting it would make "back" return you to the record
 * you were just in, which is a second detour, not the way home.
 */
export function beginDetour<T>(
  existing: Detour<T> | null,
  queue: readonly T[],
  index: number,
  label: string,
): Detour<T> {
  if (existing) return { ...existing, label };
  return { queue: [...queue], index, label };
}

/**
 * Where to pick the shuffle back up: the track *after* the one you left.
 *
 * Not the same one. You were listening to it when you went to explore its
 * record, and the record you just heard almost always contains it — starting
 * it again would play the same track twice in a row.
 *
 * Null when there is nothing to return to (an empty queue — you went
 * exploring before anything was playing).
 */
export function resumePoint<T>(
  detour: Detour<T>,
  repeat: boolean,
): { queue: T[]; index: number } | null {
  if (detour.queue.length === 0) return null;
  const next = detour.index + 1;
  if (next < detour.queue.length) return { queue: detour.queue, index: next };
  // Ran off the end of the shuffle while away. Repeat wraps, as it would
  // have if you had never left; otherwise stay on the last track.
  return { queue: detour.queue, index: repeat ? 0 : detour.queue.length - 1 };
}

/** Should moving forward leave the detour instead of stepping within it? */
export function detourEnds(index: number, delta: number, length: number): boolean {
  return delta > 0 && index + delta >= length;
}
