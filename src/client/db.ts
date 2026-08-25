"use client";

import type {
  ReleaseDetail,
  ReleaseSummary,
  Source,
  SyncState,
} from "@/lib/types";

/**
 * IndexedDB cache.
 *
 * Why the browser and not a server database: the collection index is the
 * user's own data, it is large (1,500+ releases with tracklists is a few MB),
 * and keeping it client-side means the deployment holds no user data at rest
 * at all. Nothing to breach, nothing to subpoena, no GDPR erasure workflow —
 * "log out" and "clear site data" are the same operation.
 *
 * Trade-off, stated plainly: playlists do not sync between devices in v1.
 * Export/import JSON is the escape hatch.
 */

const DB_NAME = "crateshuffle";
const DB_VERSION = 1;

const STORE_SUMMARY = "summaries";
const STORE_DETAIL = "details";
const STORE_PLAYLIST = "playlists";
const STORE_META = "meta";

export interface StoredSummary extends ReleaseSummary {
  source: Source;
  /** Composite primary key, `${source}:${id}`. */
  pk: string;
  /** Owning Discogs username — keeps two accounts on one browser separate. */
  owner: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_SUMMARY)) {
        const store = db.createObjectStore(STORE_SUMMARY, { keyPath: "pk" });
        store.createIndex("bySource", ["owner", "source"], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DETAIL)) {
        db.createObjectStore(STORE_DETAIL, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PLAYLIST)) {
        db.createObjectStore(STORE_PLAYLIST, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Database upgrade blocked by another open tab."));
  });

  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (stores: IDBObjectStore[]) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = db.transaction(names, mode);
        const stores = names.map((n) => transaction.objectStore(n));

        let result: T;
        const outcome = run(stores);

        if (outcome instanceof Promise) {
          outcome.then((v) => (result = v)).catch(reject);
        } else {
          outcome.onsuccess = () => (result = outcome.result);
          outcome.onerror = () => reject(outcome.error);
        }

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export async function putSummaries(
  owner: string,
  source: Source,
  items: ReleaseSummary[],
): Promise<void> {
  await tx<void>(STORE_SUMMARY, "readwrite", ([store]) => {
    for (const item of items) {
      store!.put({ ...item, source, owner, pk: `${owner}:${source}:${item.id}` });
    }
    return Promise.resolve();
  });
}

export async function getSummaries(
  owner: string,
  source: Source,
): Promise<StoredSummary[]> {
  return tx<StoredSummary[]>(STORE_SUMMARY, "readonly", ([store]) =>
    store!.index("bySource").getAll(IDBKeyRange.only([owner, source])),
  );
}

export async function clearSource(owner: string, source: Source): Promise<void> {
  const existing = await getSummaries(owner, source);
  await tx<void>(STORE_SUMMARY, "readwrite", ([store]) => {
    for (const item of existing) store!.delete(item.pk);
    return Promise.resolve();
  });
}

/* ------------------------------------------------------------------ */
/* Release details                                                     */
/* ------------------------------------------------------------------ */

export async function putDetails(details: ReleaseDetail[]): Promise<void> {
  await tx<void>(STORE_DETAIL, "readwrite", ([store]) => {
    for (const detail of details) store!.put(detail);
    return Promise.resolve();
  });
}

export async function getAllDetails(): Promise<ReleaseDetail[]> {
  return tx<ReleaseDetail[]>(STORE_DETAIL, "readonly", ([store]) =>
    store!.getAll(),
  );
}

export async function getDetailIds(): Promise<Set<number>> {
  const keys = await tx<IDBValidKey[]>(STORE_DETAIL, "readonly", ([store]) =>
    store!.getAllKeys(),
  );
  return new Set(keys.map((k) => Number(k)));
}

/* ------------------------------------------------------------------ */
/* Legacy playlists (pre-server-store)                                 */
/*                                                                     */
/* Playlists now live in Postgres so they follow the user between       */
/* devices. This store is kept only so that anyone who built playlists  */
/* in v1 gets them lifted into their account once, rather than losing   */
/* them silently — which is the sort of thing that makes people stop    */
/* trusting an app.                                                    */
/* ------------------------------------------------------------------ */

export interface LegacyPlaylist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: string[];
}

export async function getLegacyPlaylists(): Promise<LegacyPlaylist[]> {
  const all = await tx<LegacyPlaylist[]>(
    STORE_PLAYLIST,
    "readonly",
    ([store]) => store!.getAll(),
  );
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function clearLegacyPlaylists(): Promise<void> {
  await tx<void>(STORE_PLAYLIST, "readwrite", ([store]) => {
    store!.clear();
    return Promise.resolve();
  });
}

export async function isMigrated(owner: string): Promise<boolean> {
  const row = await tx<{ key: string; value: boolean } | undefined>(
    STORE_META,
    "readonly",
    ([store]) => store!.get(`migrated:${owner}`),
  );
  return row?.value === true;
}

export async function markMigrated(owner: string): Promise<void> {
  await tx<void>(STORE_META, "readwrite", ([store]) => {
    store!.put({ key: `migrated:${owner}`, value: true });
    return Promise.resolve();
  });
}

/* ------------------------------------------------------------------ */
/* Sync metadata                                                       */
/* ------------------------------------------------------------------ */

export async function getSyncState(
  owner: string,
  source: Source,
): Promise<SyncState | null> {
  const row = await tx<{ key: string; value: SyncState } | undefined>(
    STORE_META,
    "readonly",
    ([store]) => store!.get(`sync:${owner}:${source}`),
  );
  return row?.value ?? null;
}

export async function setSyncState(
  owner: string,
  source: Source,
  state: SyncState,
): Promise<void> {
  await tx<void>(STORE_META, "readwrite", ([store]) => {
    store!.put({ key: `sync:${owner}:${source}`, value: state });
    return Promise.resolve();
  });
}

/** Wipe everything this browser holds. Called on logout. */
export async function nuke(): Promise<void> {
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
