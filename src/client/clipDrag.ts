/**
 * Dragging a record onto a playlist.
 *
 * On a desktop the natural move is to pick a row up and drop it on the set it
 * belongs in. The drag carries one thing: the clip's key, under a MIME type
 * of our own. A drop target accepts that type and nothing else, so a link or
 * text dragged in from another tab can never become a playlist entry, and the
 * key is only ever used to look up a record the app already holds — it never
 * reaches the server as-is.
 *
 * Phones keep the + button: long-press drag on glass fights scrolling.
 */

export const CLIP_MIME = "application/x-gemtopia-clip";

/**
 * A clip (`${releaseId}:${videoId}`) or a record-only track
 * (`${releaseId}:t.B2`) — the two shapes in lib/clipKey.ts, and nothing else.
 */
export { isClipKey } from "@/lib/clipKey";
import { isClipKey } from "@/lib/clipKey";

/** Start a drag for this clip. Returns false (and sets nothing) for a non-clip key. */
export function writeClipDrag(
  transfer: Pick<DataTransfer, "setData"> & { effectAllowed: DataTransfer["effectAllowed"] },
  key: string,
): boolean {
  if (!isClipKey(key)) return false;
  transfer.setData(CLIP_MIME, key);
  transfer.effectAllowed = "copyMove";
  return true;
}

/**
 * Whether a drag in progress is one of ours. During dragover the browser
 * hides the data itself and exposes only the types, which is all we need to
 * decide whether to light up as a drop target.
 */
export function isClipDrag(transfer: Pick<DataTransfer, "types"> | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes(CLIP_MIME));
}

/** The dropped clip's key, or null for anything that is not a well-formed one. */
export function readClipDrag(transfer: Pick<DataTransfer, "getData"> | null): string | null {
  if (!transfer) return null;
  const value = transfer.getData(CLIP_MIME);
  return isClipKey(value) ? value : null;
}

/**
 * Moving a row within an open playlist.
 *
 * The same drag also carries the row's index under a second type of our own,
 * so the list it came from can tell a reorder from a record dragged in from
 * the player, and knows which row to move when the drop lands. The index
 * travels with the drag rather than living in component state because the
 * list is windowed: the row that started the drag can be recycled out of the
 * DOM before the drop, and with it any event that would have cleared that
 * state. The list checks the index against the row it names before moving
 * anything.
 */
export const ROW_MIME = "application/x-gemtopia-row";

/** Mark a drag as a row move. Returns false (and sets nothing) for a bad index. */
export function writeRowDrag(transfer: Pick<DataTransfer, "setData">, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > 999_999) return false;
  transfer.setData(ROW_MIME, String(index));
  return true;
}

/** Whether a drag in progress is a row being moved. */
export function isRowDrag(transfer: Pick<DataTransfer, "types"> | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes(ROW_MIME));
}

/** The dragged row's index, or null for anything that is not a whole number. */
export function readRowDrag(transfer: Pick<DataTransfer, "getData"> | null): number | null {
  if (!transfer) return null;
  const value = transfer.getData(ROW_MIME);
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}
