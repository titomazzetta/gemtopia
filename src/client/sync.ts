"use client";

import type { ReleaseDetail, Source, SyncState } from "@/lib/types";
import {
  getDetailIds,
  getSummaries,
  putDetails,
  putSummaries,
  setSyncState,
} from "./db";

/**
 * Incremental background sync.
 *
 * Listing a 1,500-record collection is 15 requests. Fetching the tracklist and
 * videos for each of those releases is 1,500 more — and Discogs allows 60 a
 * minute. So the first sync takes ~10 minutes and every sync after it only
 * fetches releases we have never seen. Progress is persisted after every
 * batch, so closing the tab mid-sync costs at most one batch of work.
 */

const BATCH_SIZE = 8;
/** ~24 releases/minute of headroom below the 60/min ceiling. */
const BATCH_INTERVAL_MS = 2_600;

export interface SyncHandle {
  cancel(): void;
}

interface ApiError {
  error: { code: string; message: string; retryAfter?: number };
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const error = new Error(
      body?.error?.message ?? `Request failed (${response.status})`,
    ) as Error & { code?: string; retryAfter?: number; status?: number };
    error.code = body?.error?.code;
    error.retryAfter = body?.error?.retryAfter;
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startSync(options: {
  owner: string;
  source: Source;
  onProgress: (state: SyncState) => void;
  /** Refetch details we already hold (used by "Resync everything"). */
  force?: boolean;
}): SyncHandle {
  let cancelled = false;

  const emit = (partial: Omit<SyncState, "source" | "updatedAt">) => {
    const state: SyncState = {
      ...partial,
      source: options.source,
      updatedAt: Date.now(),
    };
    options.onProgress(state);
    void setSyncState(options.owner, options.source, state);
  };

  (async () => {
    try {
      /* ---------- Phase 1: page the listing ---------- */
      emit({ detailed: 0, total: 0, status: "listing", message: "Reading your collection…" });

      let page = 1;
      let total = 0;
      /*
       * No initialiser. The do-while body always assigns this from the first
       * response before the condition reads it, so any starting value is dead
       * — and a dead `= 1` reads as "assume one page", which is the opposite
       * of what this does. CodeQL flagged it; it was right.
       */
      let pages: number;

      do {
        if (cancelled) return;

        const data = await apiGet<{
          items: Array<import("@/lib/types").ReleaseSummary>;
          page: number;
          pages: number;
          total: number;
        }>(
          `/api/discogs/collection?source=${options.source}&page=${page}&perPage=100`,
        );

        await putSummaries(options.owner, options.source, data.items);
        pages = data.pages;
        total = data.total;

        emit({
          detailed: 0,
          total,
          status: "listing",
          message: `Indexed ${Math.min(page * 100, total)} of ${total}…`,
        });

        page += 1;
        if (page <= pages) await sleep(1_100);
      } while (page <= pages);

      /* ---------- Phase 2: fill in tracklists + videos ---------- */
      if (cancelled) return;

      const summaries = await getSummaries(options.owner, options.source);
      const known = options.force ? new Set<number>() : await getDetailIds();
      const missing = summaries
        .map((s) => s.id)
        .filter((id) => !known.has(id));

      const alreadyDone = summaries.length - missing.length;

      if (missing.length === 0) {
        emit({
          detailed: summaries.length,
          total: summaries.length,
          status: "done",
          message: "Up to date.",
        });
        return;
      }

      let done = alreadyDone;

      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (cancelled) return;

        const batch = missing.slice(i, i + BATCH_SIZE);

        try {
          const data = await apiGet<{
            results: Array<
              | { id: number; ok: true; release: ReleaseDetail }
              | { id: number; ok: false; status: number }
            >;
          }>(`/api/discogs/releases?ids=${batch.join(",")}`);

          const details = data.results
            .filter((r): r is { id: number; ok: true; release: ReleaseDetail } => r.ok)
            .map((r) => r.release);

          // Releases Discogs refuses (deleted, 404) are cached as empty so we
          // do not retry them on every future sync.
          const failed = data.results.filter((r) => !r.ok).map((r) => r.id);
          const placeholders: ReleaseDetail[] = failed.map((id) => {
            const summary = summaries.find((s) => s.id === id);
            return {
              id,
              title: summary?.title ?? "Unavailable",
              artist: summary?.artist ?? "Unknown Artist",
              year: summary?.year ?? null,
              genres: summary?.genres ?? [],
              styles: summary?.styles ?? [],
              labels: summary?.labels ?? [],
              formats: summary?.formats ?? [],
              country: summary?.country ?? null,
              artistIds: summary?.artistIds ?? [],
              labelIds: summary?.labelIds ?? [],
              thumb: summary?.thumb ?? "",
              coverImage: summary?.coverImage ?? "",
              addedAt: summary?.addedAt ?? null,
              notes: null,
              market: null,
              tracks: [],
              videos: [],
              fetchedAt: Date.now(),
            };
          });

          await putDetails([...details, ...placeholders]);
          done += batch.length;

          emit({
            detailed: done,
            total: summaries.length,
            status: "detailing",
            message: `Loading tracks — ${done} of ${summaries.length}`,
          });
        } catch (error) {
          const err = error as { code?: string; retryAfter?: number };

          if (err.code === "rate_limited") {
            const wait = Math.min(120, Math.max(15, err.retryAfter ?? 60));
            emit({
              detailed: done,
              total: summaries.length,
              status: "paused",
              message: `Discogs rate limit — resuming in ${wait}s`,
            });
            await sleep(wait * 1_000);
            i -= BATCH_SIZE; // retry this batch
            continue;
          }

          // session_revoked: signed out everywhere from another device. Not
          // transient — retrying every remaining batch would just fail each one.
          if (
            err.code === "unauthenticated" ||
            err.code === "session_revoked" ||
            err.code === "discogs_unauthorized"
          ) {
            emit({
              detailed: done,
              total: summaries.length,
              status: "error",
              message: "Session expired — please sign in again.",
            });
            return;
          }

          // Transient: skip the batch, keep going.
          console.warn("[sync] batch failed", error);
        }

        await sleep(BATCH_INTERVAL_MS);
      }

      if (!cancelled) {
        emit({
          detailed: done,
          total: summaries.length,
          status: "done",
          message: "Crate ready.",
        });
      }
    } catch (error) {
      if (cancelled) return;
      console.error("[sync]", error);
      emit({
        detailed: 0,
        total: 0,
        status: "error",
        message:
          error instanceof Error ? error.message : "Sync failed unexpectedly.",
      });
    }
  })();

  return {
    cancel() {
      cancelled = true;
    },
  };
}
