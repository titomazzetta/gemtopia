/**
 * Picking several tracks at once, and what a set of picked tracks can do.
 *
 * A selection is a set of clip keys, not of row positions. Positions move: a
 * collaborator's edit lands, a filter changes, a block of rows is dragged
 * somewhere else. A key stays the same track through all of it. In the rare
 * playlist that holds one clip twice (only an old import can make one),
 * picking the key picks both rows, which is what "this track" means anyway.
 *
 * Everything here is pure, so the arithmetic that is easy to get wrong —
 * shift-click ranges, where a dragged block lands, what a bulk add skips —
 * is pinned by scripts/test-selection.mjs.
 */

export type Selection = ReadonlySet<string>;

export const NO_SELECTION: Selection = new Set<string>();

/** Tick a track, or untick it. Never mutates. */
export function toggleKey(selection: Selection, key: string): Set<string> {
  const next = new Set(selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Shift-click: tick every track from the anchor (the last one you ticked) to
 * this one, in the order the list shows them. Adds to what's already ticked,
 * the way it works in a file manager. With no anchor on screen, it ticks just
 * this one.
 */
export function selectRange(
  selection: Selection,
  order: readonly string[],
  anchor: string | null,
  target: string,
): Set<string> {
  const to = order.indexOf(target);
  if (to === -1) return new Set(selection);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (from === -1) {
    const next = new Set(selection);
    next.add(target);
    return next;
  }
  const next = new Set(selection);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  for (let i = lo; i <= hi; i += 1) next.add(order[i] as string);
  return next;
}

/** Tick everything in `order` as well as what's already ticked. */
export function selectAll(selection: Selection, order: readonly string[]): Set<string> {
  const next = new Set(selection);
  for (const key of order) next.add(key);
  return next;
}

/** Only the ticks for tracks that still exist here. */
export function presentOnly(selection: Selection, keys: Iterable<string>): Set<string> {
  const next = new Set<string>();
  for (const key of keys) if (selection.has(key)) next.add(key);
  return next;
}

/**
 * The ticked tracks in a sensible order: as the list on screen has them,
 * then any ticked earlier and hidden since by a filter, in the order of the
 * whole pool. Clicking order would be arbitrary; this is the order you see.
 */
export function inOrder<T extends { key: string }>(
  selection: Selection,
  visible: readonly T[],
  pool: readonly T[],
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const list of [visible, pool]) {
    for (const item of list) {
      if (!selection.has(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
}

export interface AddPlan<E> {
  /** What to append to the playlist, in order. */
  entries: E[];
  /** Ticked tracks the playlist already holds. */
  already: number;
  /** Ticked tracks that can't go in a playlist yet (not synced from Discogs). */
  notReady: number;
  /** Ticked tracks that didn't fit under the playlist's size limit. */
  overflow: number;
}

/**
 * Adding several tracks to a playlist in one save: skip the ones it already
 * holds (and repeats within the selection), skip the ones that can't be
 * entries yet, and stop at the playlist's size limit. Says how many of each,
 * so the toast can tell you what happened instead of a bare "done".
 */
export function planAdd<T extends { key: string }, E>(
  existingKeys: readonly string[],
  items: readonly T[],
  toEntry: (item: T) => E | null,
  limit: number,
): AddPlan<E> {
  const have = new Set(existingKeys);
  const room = Math.max(0, limit - existingKeys.length);
  const entries: E[] = [];
  let already = 0;
  let notReady = 0;
  let overflow = 0;
  for (const item of items) {
    if (have.has(item.key)) {
      already += 1;
      continue;
    }
    const entry = toEntry(item);
    if (entry === null) {
      notReady += 1;
      continue;
    }
    have.add(item.key);
    if (entries.length >= room) {
      overflow += 1;
      continue;
    }
    entries.push(entry);
  }
  return { entries, already, notReady, overflow };
}

export interface RemovePlan<E> {
  /** The playlist without the removed rows, in its order. */
  keep: E[];
  /** Rows taken out. */
  removed: number;
  /** Ticked rows you can't take out (on a shared set: someone else's). */
  refused: number;
}

/**
 * Taking the ticked tracks out of a playlist, under the same rule as one at a
 * time: `canRemove` says whether this row is yours to take out (on a shared
 * set, a collaborator removes only what they added). Refused rows stay, and
 * are counted so the bar can say why they're still there.
 */
export function planRemove<E extends { clipKey: string }>(
  entries: readonly E[],
  selection: Selection,
  canRemove: (entry: E, index: number) => boolean,
): RemovePlan<E> {
  const keep: E[] = [];
  let removed = 0;
  let refused = 0;
  entries.forEach((entry, index) => {
    if (!selection.has(entry.clipKey)) {
      keep.push(entry);
    } else if (canRemove(entry, index)) {
      removed += 1;
    } else {
      refused += 1;
      keep.push(entry);
    }
  });
  return { keep, removed, refused };
}

/** Distinct, in-range row indices, ascending. */
function cleanIndices(length: number, indices: readonly number[]): number[] {
  return [...new Set(indices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < length)
    .sort((a, b) => a - b);
}

/**
 * Move several rows together to a slot — a gap between rows, 0 to n, counted
 * in the list as it was before anything moved (see pullList.slotToIndex).
 * The rows keep their order among themselves, and close up behind them.
 *
 * With one row this is exactly a single move: moveBlock(list, [from], slot)
 * equals moveEntry(list, from, slotToIndex(from, slot)), which the tests
 * check for every row and every gap.
 */
export function moveBlock<T>(entries: readonly T[], indices: readonly number[], slot: number): T[] {
  const picked = cleanIndices(entries.length, indices);
  if (picked.length === 0 || !Number.isInteger(slot)) return [...entries];
  const at = Math.max(0, Math.min(entries.length, slot));
  const set = new Set(picked);
  const block = picked.map((i) => entries[i] as T);
  const rest = entries.filter((_, i) => !set.has(i));
  // Rows of the block above the slot are gone from `rest`, so the gap moves up by that many.
  const insertAt = at - picked.filter((i) => i < at).length;
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

/** Whether dropping these rows on this gap would leave the list as it is. */
export function isNoopBlockMove(length: number, indices: readonly number[], slot: number): boolean {
  const picked = cleanIndices(length, indices);
  if (picked.length === 0) return true;
  const order = Array.from({ length }, (_, i) => i);
  const moved = moveBlock(order, picked, slot);
  return moved.every((value, i) => value === i);
}

/* ---------------- what the toast says ---------------- */

const tracks = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "track" : "tracks"}`;

/** After a bulk add: what went in, and what didn't, and why. */
export function addedMessage(name: string, plan: AddPlan<unknown>, limit: number): string {
  const added = plan.entries.length;
  const extras: string[] = [];
  if (plan.already > 0) extras.push(`${plan.already.toLocaleString("en-US")} already in it`);
  if (plan.notReady > 0) extras.push(`${plan.notReady.toLocaleString("en-US")} not synced yet`);
  if (plan.overflow > 0) {
    extras.push(`${plan.overflow.toLocaleString("en-US")} didn't fit — a set holds ${limit.toLocaleString("en-US")}`);
  }
  if (added > 0) return [`Added ${tracks(added)} to ${name}`, ...extras].join(" · ");
  if (plan.overflow > 0) return `${name} is full — a set holds ${limit.toLocaleString("en-US")}`;
  if (plan.notReady === 0) {
    return plan.already === 1 ? `Already in ${name}` : `All ${plan.already.toLocaleString("en-US")} are already in ${name}`;
  }
  if (plan.already === 0) return "Those haven't synced from Discogs yet, so they can't go in a playlist";
  return [`Nothing new for ${name}`, ...extras].join(" · ");
}

/** After a bulk remove: what came out, and why anything ticked is still there. */
export function removedMessage(name: string, plan: Pick<RemovePlan<unknown>, "removed" | "refused">): string {
  if (plan.removed === 0) {
    return plan.refused === 1
      ? "That one was added by someone else — you can take out only what you added"
      : "Those were added by others — you can take out only what you added";
  }
  const head = `Took ${tracks(plan.removed)} out of ${name}`;
  if (plan.refused === 0) return head;
  return `${head} · ${plan.refused.toLocaleString("en-US")} added by others stay — you can take out only what you added`;
}

/** After tagging a selection. */
export function taggedMessage(
  result: { tag: string; tagged: number; already: number; full: number },
  notSynced: number,
  perTrack: number,
): string {
  const extras: string[] = [];
  if (result.already > 0) extras.push(`${result.already.toLocaleString("en-US")} already had it`);
  if (result.full > 0) extras.push(`${result.full.toLocaleString("en-US")} at ${perTrack} tags already`);
  if (notSynced > 0) extras.push(`${notSynced.toLocaleString("en-US")} not synced yet`);
  if (result.tagged > 0) return [`Tagged ${tracks(result.tagged)} #${result.tag}`, ...extras].join(" · ");
  if (result.already > 0 && result.full === 0 && notSynced === 0) {
    return result.already === 1 ? `It already has #${result.tag}` : `All ${result.already.toLocaleString("en-US")} already have #${result.tag}`;
  }
  return [`Nothing to tag #${result.tag}`, ...extras].join(" · ");
}
