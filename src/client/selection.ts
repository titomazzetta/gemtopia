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

/** A row taken out of a playlist, and where it stood before it went. */
export interface TakenRow<E> {
  index: number;
  entry: E;
}

export interface RemovePlan<E> {
  /** The playlist without the removed rows, in its order. */
  keep: E[];
  /** Rows taken out. */
  removed: number;
  /** Ticked rows you can't take out (on a shared set: someone else's). */
  refused: number;
  /** The rows taken out, with their places — what an undo needs. */
  taken: TakenRow<E>[];
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
  const taken: TakenRow<E>[] = [];
  let refused = 0;
  entries.forEach((entry, index) => {
    if (!selection.has(entry.clipKey)) {
      keep.push(entry);
    } else if (canRemove(entry, index)) {
      taken.push({ index, entry });
    } else {
      refused += 1;
      keep.push(entry);
    }
  });
  return { keep, removed: taken.length, refused, taken };
}

export interface PutBackPlan<E> {
  /** The playlist with the rows back in it. */
  entries: E[];
  /** Rows put back. */
  restored: number;
  /** Rows left out because the set holds that clip again already. */
  already: number;
  /** Rows that no longer fit under the set's limit. */
  overflow: number;
}

/**
 * Putting back rows that were just taken out — the undo for a remove.
 *
 * Built from the playlist as it is *now*, never from a copy of how it was.
 * On a shared set someone may have added a record in the seconds between the
 * remove and the undo, and restoring a snapshot would quietly take theirs out
 * again (the reason `canRestore` withdraws a reorder's undo). Putting rows
 * back into the current list cannot do that: it only ever adds.
 *
 * Each row returns to the place it stood in, or to the end if the list is
 * now shorter than that, in the order the rows had among themselves. With
 * nothing else changed that is exactly the list as it was. A clip the set
 * holds again already is left alone — somebody put it back first — and
 * nothing goes in past the set's limit.
 */
export function planPutBack<E extends { clipKey: string }>(
  current: readonly E[],
  taken: readonly TakenRow<E>[],
  limit: number,
): PutBackPlan<E> {
  const entries = [...current];
  // Judged against the list before this undo touches it, so both rows of a
  // doubled clip come back together rather than the first blocking the second.
  const present = new Set(current.map((entry) => entry.clipKey));
  let restored = 0;
  let already = 0;
  let overflow = 0;
  const rows = taken
    .filter((row) => Number.isInteger(row.index) && row.index >= 0)
    .sort((a, b) => a.index - b.index);
  for (const row of rows) {
    if (present.has(row.entry.clipKey)) {
      already += 1;
      continue;
    }
    if (entries.length >= limit) {
      overflow += 1;
      continue;
    }
    entries.splice(Math.min(row.index, entries.length), 0, row.entry);
    restored += 1;
  }
  return { entries, restored, already, overflow };
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

/**
 * After a remove: what came out, and why anything ticked is still there.
 *
 * One track is named when its title is known. The bin on a phone's row is a
 * small target beside another one, and "Took 1 track out" does not say whether
 * it was the track you meant.
 */
export function removedMessage(
  name: string,
  plan: Pick<RemovePlan<unknown>, "removed" | "refused">,
  title?: string,
): string {
  if (plan.removed === 0) {
    return plan.refused === 1
      ? "That one was added by someone else — you can take out only what you added"
      : "Those were added by others — you can take out only what you added";
  }
  const head =
    plan.removed === 1 && title ? `Took “${title}” out of ${name}` : `Took ${tracks(plan.removed)} out of ${name}`;
  if (plan.refused === 0) return head;
  return `${head} · ${plan.refused.toLocaleString("en-US")} added by others stay — you can take out only what you added`;
}

/** After an undone remove: what went back, and why anything didn't. */
export function putBackMessage(
  name: string,
  plan: Pick<PutBackPlan<unknown>, "restored" | "already" | "overflow">,
  limit: number,
): string {
  if (plan.restored === 0) {
    if (plan.overflow > 0) return `${name} is full — a set holds ${limit.toLocaleString("en-US")}`;
    return plan.already === 1 ? `Already back in ${name}` : `Those are already back in ${name}`;
  }
  const extras: string[] = [];
  if (plan.already > 0) extras.push(`${plan.already.toLocaleString("en-US")} already back`);
  if (plan.overflow > 0) {
    extras.push(`${plan.overflow.toLocaleString("en-US")} didn't fit — a set holds ${limit.toLocaleString("en-US")}`);
  }
  return [`Put ${tracks(plan.restored)} back in ${name}`, ...extras].join(" · ");
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
