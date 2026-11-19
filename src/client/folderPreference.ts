/**
 * The Folder filter as a standing choice.
 *
 * Every other filter is for this session — a style, a decade, a tempo
 * window — and resets on the next visit. "Don't play my listening albums"
 * is not a session's choice but a standing one, so the Folder filter alone
 * is kept on the device and put back at the next boot. It shows like any
 * other active filter: the chips lit, the count in the filters badge, Reset
 * clearing it.
 *
 * What's kept: whose choice it is, the folder names and the only/hide
 * switch. Parsed as untrusted on the way back in, like the other notes on
 * this device (client/resume.ts). It has no expiry — it is a preference, not
 * a memory — so it names its account: another login on the same device
 * starts with no choice and never sees this one's folder names. Wiped on
 * sign-out.
 */

export const FOLDER_PREFERENCE_KEY = "gt_folders_v1";
const MAX_FOLDERS = 60;
const MAX_NAME = 80;

export interface FolderPreference {
  folders: string[];
  hide: boolean;
}

export function serializeFolderPreference(preference: FolderPreference, user: string): string {
  return JSON.stringify({ v: 1, user, folders: preference.folders.slice(0, MAX_FOLDERS), hide: preference.hide });
}

/** Null when there is nothing usable: missing, malformed, empty, or someone else's. */
export function parseFolderPreference(raw: string | null | undefined, user: string): FolderPreference | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || !Array.isArray(d.folders)) return null;
  if (typeof d.user !== "string" || d.user !== user) return null;
  const folders = [
    ...new Set(d.folders.filter((f): f is string => typeof f === "string" && f.trim() !== "" && f.length <= MAX_NAME)),
  ].slice(0, MAX_FOLDERS);
  if (folders.length === 0) return null;
  return { folders, hide: d.hide === true };
}

export function readFolderPreference(user: string): FolderPreference | null {
  try {
    return parseFolderPreference(window.localStorage.getItem(FOLDER_PREFERENCE_KEY), user);
  } catch {
    return null;
  }
}

/** Keep the choice; with no folder ticked there is none, and the note goes. */
export function writeFolderPreference(preference: FolderPreference, user: string): void {
  try {
    if (preference.folders.length === 0) window.localStorage.removeItem(FOLDER_PREFERENCE_KEY);
    else window.localStorage.setItem(FOLDER_PREFERENCE_KEY, serializeFolderPreference(preference, user));
  } catch {
    /* private mode or a full store: the choice lasts the session */
  }
}

export function forgetFolderPreference(): void {
  try {
    window.localStorage.removeItem(FOLDER_PREFERENCE_KEY);
  } catch {
    /* nothing to forget */
  }
}
