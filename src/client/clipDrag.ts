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
