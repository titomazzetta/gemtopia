/**
 * Moving one row of a playlist to another position.
 *
 * Small enough to look obviously correct, which is exactly why it is worth
 * pinning. Remove-then-insert shifts every index after `from` down by one, so
 * "insert at `to`" means something different depending on whether you dragged
 * the row up or down — and the version that looks right for one direction is
 * off by one in the other. The same class of mistake as the queue index bug
 * this refactor already turned up.
 *
 * The convention here is *drop-on-target*: `to` is the index of the row you
 * dropped onto, in the list as it looked before you picked anything up, and
 * the dragged row ends up at that index.
 */
export function moveEntry<T>(entries: readonly T[], from: number, to: number): T[] {
  // Out of range, or no movement: hand back a copy rather than the original,
  // so a caller can never mutate React state by accident on the no-op path.
  if (
    from === to ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= entries.length ||
    to >= entries.length
  ) {
    return [...entries];
  }

  const next = [...entries];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...entries];
  next.splice(to, 0, moved);
  return next;
}
