"use client";

import type {
  AnalysisResult,
  DigResponse,
  Playlist,
  PlaylistItemRow,
  ReleaseDetail,
  TrackMeta,
} from "@/lib/types";

/**
 * Typed client for our own API.
 *
 * Two things every mutating call does, in one place so no call site can forget:
 * send the CSRF token, and send credentials same-origin only.
 */

let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const mutating = Boolean(init.method && init.method !== "GET");

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-csrf-token": csrfToken } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; retryAfter?: number };
    } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code ?? "unknown",
      response.status,
      body?.error?.retryAfter,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

export const playlistsApi = {
  list: () =>
    request<{ playlists: Playlist[] }>("/api/playlists").then((r) => r.playlists),

  create: (name: string, entries: Omit<PlaylistItemRow, "position">[] = []) =>
    request<{ playlist: Playlist }>("/api/playlists", {
      method: "POST",
      body: JSON.stringify({ name, entries }),
    }).then((r) => r.playlist),

  update: (
    id: string,
    patch: { name?: string; entries?: Omit<PlaylistItemRow, "position">[] },
  ) =>
    request<{ playlist: Playlist }>(`/api/playlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.playlist),

  remove: (id: string) =>
    request<{ ok: true }>(`/api/playlists/${id}`, { method: "DELETE" }),

  /** One-time migration of playlists created before the server store. */
  importAll: (
    playlists: Array<{
      name: string;
      entries: Omit<PlaylistItemRow, "position">[];
    }>,
  ) =>
    request<{ imported: number; playlists: Playlist[] }>("/api/playlists", {
      method: "PUT",
      body: JSON.stringify({ playlists }),
    }),
};

/* ------------------------------------------------------------------ */
/* BPM / key catalogue                                                 */
/* ------------------------------------------------------------------ */

export const trackMetaApi = {
  list: () =>
    request<{ entries: TrackMeta[] }>("/api/track-meta").then((r) => r.entries),

  save: (entries: TrackMeta[]) =>
    request<{ written: number }>("/api/track-meta", {
      method: "PUT",
      body: JSON.stringify({ entries }),
    }),
};

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export const prefsApi = {
  get: () => request<{ pitchPercent: number }>("/api/prefs"),

  setPitch: (pitchPercent: number) =>
    request<{ pitchPercent: number }>("/api/prefs", {
      method: "PATCH",
      body: JSON.stringify({ pitchPercent }),
    }),
};

/* ------------------------------------------------------------------ */
/* Digging                                                             */
/* ------------------------------------------------------------------ */

export interface DigSeedPayload {
  releaseId: number;
  artistIds: number[];
  artistNames: string[];
  labelIds: number[];
  labelNames: string[];
  styles: string[];
  genres: string[];
  year: number | null;
  country: string | null;
}

export const digApi = {
  dig: (payload: {
    seed: DigSeedPayload;
    excludeReleaseIds: number[];
    seenReleaseIds: number[];
    includeWantlist: boolean;
    wantlistReleaseIds: number[];
  }) =>
    request<DigResponse>("/api/dig", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const wantlistApi = {
  add: (releaseId: number) =>
    request<{ ok: true; releaseId: number; wanted: boolean }>("/api/wantlist", {
      method: "PUT",
      body: JSON.stringify({ releaseId }),
    }),

  remove: (releaseId: number) =>
    request<{ ok: true; releaseId: number; wanted: boolean }>(
      `/api/wantlist?releaseId=${releaseId}`,
      { method: "DELETE" },
    ),
};

export const releasesApi = {
  /** Full detail — tracklist, videos, marketplace signals — for up to 8 ids. */
  detail: (ids: number[]) =>
    request<{
      results: Array<
        | { id: number; ok: true; release: ReleaseDetail }
        | { id: number; ok: false; status: number }
      >;
    }>(`/api/discogs/releases?ids=${ids.slice(0, 8).join(",")}`),
};

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export interface InsightsResponse extends AnalysisResult {
  llmAvailable: boolean;
  llmSkipped: string | null;
}

export const insightsApi = {
  analyse: (payload: {
    playlistId: string;
    refresh: boolean;
    seeds: Array<{
      releaseId: number;
      artistIds: number[];
      artistNames: string[];
      labelIds: number[];
      labelNames: string[];
      styles: string[];
      genres: string[];
      country: string | null;
      year: number | null;
    }>;
    ownedReleaseIds: number[];
    wantlistReleaseIds: number[];
  }) =>
    request<InsightsResponse>("/api/insights", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
