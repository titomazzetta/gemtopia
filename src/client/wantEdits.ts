/**
 * Wantlist changes made on this page, laid over what IndexedDB says.
 *
 * The heart writes to Discogs and then to what's on screen — not to
 * IndexedDB, which holds the wantlist as a listing last read it. So the next
 * time the app re-read IndexedDB (a sync's progress, the background listing
 * finishing), the change was gone and the heart flipped back, though Discogs
 * had it. These edits are kept until a listing that started after them has
 * read Discogs's answer back, and every re-read applies them on top.
 *
 * Only a complete listing retires them, because only it can drop a release:
 * a full sync adds what it finds and forgets nothing, so retiring a removal
 * after one would bring the record back.
 */
export interface WantEdit {
  wanted: boolean;
  /** When Discogs confirmed it (Date.now()). */
  at: number;
}

/** `ids` as IndexedDB has them, with this page's changes on top. */
export function applyWantEdits(
  ids: ReadonlySet<number>,
  edits: ReadonlyMap<number, WantEdit>,
): Set<number> {
  const out = new Set(ids);
  for (const [id, edit] of edits) {
    if (edit.wanted) out.add(id);
    else out.delete(id);
  }
  return out;
}

/**
 * A listing that started at `startedAt` and read to its last page has seen
 * every change confirmed before it began: forget those. A change made while
 * it was paging may have landed after the page that would show it was read,
 * so it stays for the next one.
 */
export function retireWantEdits(edits: Map<number, WantEdit>, startedAt: number): void {
  for (const [id, edit] of edits) {
    if (edit.at < startedAt) edits.delete(id);
  }
}
