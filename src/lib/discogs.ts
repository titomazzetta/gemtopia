import "server-only";
import { z } from "zod";
import { buildAuthHeader, parseTokenResponse } from "./oauth1";
import { env, USER_AGENT } from "./env";
import type {
  CollectionPage,
  ReleaseDetail,
  ReleaseSummary,
  Track,
  YouTubeVideo,
} from "./types";

const API = "https://api.discogs.com";

export class DiscogsError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "DiscogsError";
  }
}

/* ------------------------------------------------------------------ */
/* Signed transport                                                    */
/* ------------------------------------------------------------------ */

interface UserToken {
  token: string;
  tokenSecret: string;
}

async function signedFetch(
  method: "GET" | "POST",
  url: string,
  user?: UserToken,
  extraOAuth: Record<string, string> = {},
): Promise<Response> {
  const authorization = buildAuthHeader(
    method,
    url,
    {
      consumerKey: env.DISCOGS_CONSUMER_KEY,
      consumerSecret: env.DISCOGS_CONSUMER_SECRET,
      token: user?.token,
      tokenSecret: user?.tokenSecret,
    },
    extraOAuth,
  );

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    // Discogs data is user-specific and rate limited; never let a CDN cache it.
    cache: "no-store",
    // Hard ceiling so a hung upstream cannot pin a serverless invocation open.
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after") ?? "60");
    throw new DiscogsError("Discogs rate limit reached", 429, retry);
  }

  return response;
}

async function getJson<T>(
  path: string,
  user: UserToken,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await signedFetch("GET", `${API}${path}`, user);

  if (!response.ok) {
    // Never echo the upstream body back to the browser — it can contain
    // request context we would rather not mirror into a client error message.
    throw new DiscogsError(
      response.status === 401
        ? "Discogs rejected the stored credentials"
        : `Discogs request failed (${response.status})`,
      response.status,
    );
  }

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new DiscogsError("Unexpected response shape from Discogs", 502);
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* OAuth 1.0a handshake                                                */
/* ------------------------------------------------------------------ */

export async function requestToken(callbackUrl: string): Promise<{
  token: string;
  tokenSecret: string;
}> {
  const response = await signedFetch(
    "GET",
    `${API}/oauth/request_token`,
    undefined,
    { oauth_callback: callbackUrl },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new DiscogsError("Could not start Discogs sign-in", response.status);
  }

  const fields = parseTokenResponse(body);
  const token = fields.oauth_token;
  const tokenSecret = fields.oauth_token_secret;
  if (!token || !tokenSecret) {
    throw new DiscogsError("Malformed request-token response", 502);
  }
  return { token, tokenSecret };
}

export function authorizeUrl(requestTokenValue: string): string {
  const url = new URL("https://www.discogs.com/oauth/authorize");
  url.searchParams.set("oauth_token", requestTokenValue);
  return url.toString();
}

export async function accessToken(params: {
  requestToken: string;
  requestSecret: string;
  verifier: string;
}): Promise<{ token: string; tokenSecret: string }> {
  const response = await signedFetch(
    "POST",
    `${API}/oauth/access_token`,
    { token: params.requestToken, tokenSecret: params.requestSecret },
    { oauth_verifier: params.verifier },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new DiscogsError("Could not complete Discogs sign-in", response.status);
  }

  const fields = parseTokenResponse(body);
  const token = fields.oauth_token;
  const tokenSecret = fields.oauth_token_secret;
  if (!token || !tokenSecret) {
    throw new DiscogsError("Malformed access-token response", 502);
  }
  return { token, tokenSecret };
}

/* ------------------------------------------------------------------ */
/* Response schemas — we validate everything that crosses the wire     */
/* ------------------------------------------------------------------ */

const paginationSchema = z.object({
  page: z.number(),
  pages: z.number(),
  per_page: z.number(),
  items: z.number(),
});

const basicInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  year: z.number().nullish(),
  thumb: z.string().nullish(),
  cover_image: z.string().nullish(),
  country: z.string().nullish(),
  artists: z
    .array(
      z.object({
        id: z.number().nullish(),
        name: z.string(),
        join: z.string().nullish(),
      }),
    )
    .nullish(),
  labels: z
    .array(z.object({ id: z.number().nullish(), name: z.string() }))
    .nullish(),
  formats: z
    .array(
      z.object({
        name: z.string().nullish(),
        descriptions: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
  genres: z.array(z.string()).nullish(),
  styles: z.array(z.string()).nullish(),
});

const identitySchema = z.object({
  username: z.string(),
  id: z.number(),
});

const collectionSchema = z.object({
  pagination: paginationSchema,
  releases: z.array(
    z.object({
      id: z.number(),
      date_added: z.string().nullish(),
      basic_information: basicInfoSchema,
    }),
  ),
});

const wantlistSchema = z.object({
  pagination: paginationSchema,
  wants: z.array(
    z.object({
      id: z.number(),
      date_added: z.string().nullish(),
      basic_information: basicInfoSchema,
    }),
  ),
});

const releaseSchema = z.object({
  id: z.number(),
  title: z.string(),
  year: z.number().nullish(),
  thumb: z.string().nullish(),
  country: z.string().nullish(),
  notes: z.string().nullish(),
  genres: z.array(z.string()).nullish(),
  styles: z.array(z.string()).nullish(),
  artists: z
    .array(
      z.object({
        id: z.number().nullish(),
        name: z.string(),
        join: z.string().nullish(),
      }),
    )
    .nullish(),
  labels: z
    .array(z.object({ id: z.number().nullish(), name: z.string() }))
    .nullish(),
  formats: z
    .array(
      z.object({
        name: z.string().nullish(),
        descriptions: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
  images: z.array(z.object({ uri: z.string().nullish() })).nullish(),
  tracklist: z
    .array(
      z.object({
        position: z.string().nullish(),
        type_: z.string().nullish(),
        title: z.string().nullish(),
        duration: z.string().nullish(),
        artists: z.array(z.object({ name: z.string() })).nullish(),
      }),
    )
    .nullish(),
  videos: z
    .array(
      z.object({
        uri: z.string().nullish(),
        title: z.string().nullish(),
        duration: z.number().nullish(),
        embed: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Discogs disambiguates duplicate artist names as "Aphex Twin (2)". */
function cleanArtistName(name: string): string {
  return name.replace(/\s\(\d+\)$/, "").trim();
}

function joinArtists(
  artists: Array<{ name: string; join?: string | null }> | null | undefined,
): string {
  if (!artists || artists.length === 0) return "Unknown Artist";
  return artists
    .map((a, i) => {
      const name = cleanArtistName(a.name);
      const join = a.join?.trim();
      if (i === artists.length - 1 || !join) return name;
      return join === "," ? `${name},` : `${name} ${join}`;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenFormats(
  formats:
    | Array<{ name?: string | null; descriptions?: string[] | null }>
    | null
    | undefined,
): string[] {
  if (!formats) return [];
  const out = new Set<string>();
  for (const f of formats) {
    if (f.name) out.add(f.name);
    for (const d of f.descriptions ?? []) out.add(d);
  }
  return [...out];
}

/**
 * Pull the 11-character video ID out of any YouTube URL shape Discogs stores
 * (watch?v=, youtu.be/, /embed/, /v/, /shorts/). Returns null for anything
 * that is not YouTube — Discogs occasionally holds Vimeo or dead links.
 */
export function youtubeId(uri: string | null | undefined): string | null {
  if (!uri) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const idPattern = /^[A-Za-z0-9_-]{11}$/;

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return idPattern.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && idPattern.test(v)) return v;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && ["embed", "v", "shorts", "live"].includes(segments[0]!)) {
      const id = segments[1]!;
      return idPattern.test(id) ? id : null;
    }
  }

  return null;
}

function ids(
  entries: Array<{ id?: number | null }> | null | undefined,
): number[] {
  if (!entries) return [];
  const out: number[] = [];
  for (const entry of entries) {
    if (typeof entry.id === "number" && entry.id > 0) out.push(entry.id);
  }
  return [...new Set(out)];
}

function toSummary(
  info: z.infer<typeof basicInfoSchema>,
  addedAt: string | null,
): ReleaseSummary {
  return {
    id: info.id,
    title: info.title,
    artist: joinArtists(info.artists),
    year: info.year && info.year > 0 ? info.year : null,
    genres: info.genres ?? [],
    styles: info.styles ?? [],
    labels: (info.labels ?? []).map((l) => cleanArtistName(l.name)),
    formats: flattenFormats(info.formats),
    country: info.country?.trim() || null,
    artistIds: ids(info.artists),
    labelIds: ids(info.labels),
    thumb: info.thumb ?? "",
    coverImage: info.cover_image ?? info.thumb ?? "",
    addedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function getIdentity(user: UserToken): Promise<string> {
  const identity = await getJson("/oauth/identity", user, identitySchema);
  return identity.username;
}

export async function getCollectionPage(
  user: UserToken,
  username: string,
  page: number,
  perPage = 100,
): Promise<CollectionPage<ReleaseSummary>> {
  const path =
    `/users/${encodeURIComponent(username)}/collection/folders/0/releases` +
    `?page=${page}&per_page=${perPage}&sort=added&sort_order=desc`;

  const data = await getJson(path, user, collectionSchema);
  return {
    items: data.releases.map((r) =>
      toSummary(r.basic_information, r.date_added ?? null),
    ),
    page: data.pagination.page,
    pages: data.pagination.pages,
    perPage: data.pagination.per_page,
    total: data.pagination.items,
  };
}

export async function getWantlistPage(
  user: UserToken,
  username: string,
  page: number,
  perPage = 100,
): Promise<CollectionPage<ReleaseSummary>> {
  const path =
    `/users/${encodeURIComponent(username)}/wants` +
    `?page=${page}&per_page=${perPage}&sort=added&sort_order=desc`;

  const data = await getJson(path, user, wantlistSchema);
  return {
    items: data.wants.map((r) =>
      toSummary(r.basic_information, r.date_added ?? null),
    ),
    page: data.pagination.page,
    pages: data.pagination.pages,
    perPage: data.pagination.per_page,
    total: data.pagination.items,
  };
}

export async function getRelease(
  user: UserToken,
  releaseId: number,
): Promise<ReleaseDetail> {
  const data = await getJson(`/releases/${releaseId}`, user, releaseSchema);

  const tracks: Track[] = (data.tracklist ?? [])
    // "index" and "heading" rows are section markers, not playable tracks.
    .filter((t) => (t.type_ ?? "track") === "track" && t.title)
    .map((t) => ({
      position: (t.position ?? "").trim(),
      title: (t.title ?? "").trim(),
      duration: t.duration?.trim() || null,
      artists: (t.artists ?? []).map((a) => cleanArtistName(a.name)),
    }));

  const seen = new Set<string>();
  const videos: YouTubeVideo[] = [];
  for (const v of data.videos ?? []) {
    const id = youtubeId(v.uri);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    videos.push({
      id,
      title: (v.title ?? "").trim(),
      duration: v.duration && v.duration > 0 ? v.duration : null,
    });
  }

  return {
    id: data.id,
    title: data.title,
    artist: joinArtists(data.artists),
    year: data.year && data.year > 0 ? data.year : null,
    genres: data.genres ?? [],
    styles: data.styles ?? [],
    labels: (data.labels ?? []).map((l) => cleanArtistName(l.name)),
    formats: flattenFormats(data.formats),
    country: data.country?.trim() || null,
    artistIds: ids(data.artists),
    labelIds: ids(data.labels),
    thumb: data.thumb ?? "",
    coverImage: data.images?.[0]?.uri ?? data.thumb ?? "",
    addedAt: null,
    notes: data.notes?.slice(0, 4000) ?? null,
    tracks,
    videos,
    fetchedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Graph traversal — used by the recommender                           */
/* ------------------------------------------------------------------ */

const relatedReleaseSchema = z.object({
  pagination: paginationSchema,
  releases: z.array(
    z.object({
      // Artist discographies return both `release` and `master` rows; the
      // master rows point at a group, not a pressing.
      id: z.number(),
      type: z.string().nullish(),
      main_release: z.number().nullish(),
      title: z.string(),
      year: z.number().nullish(),
      thumb: z.string().nullish(),
      artist: z.string().nullish(),
      label: z.string().nullish(),
      role: z.string().nullish(),
      format: z.string().nullish(),
    }),
  ),
});

export interface RelatedRelease {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  thumb: string;
  label: string | null;
}

function toRelated(
  row: z.infer<typeof relatedReleaseSchema>["releases"][number],
): RelatedRelease | null {
  // "Main" is the canonical pressing of a master; prefer it when present.
  const id = row.type === "master" && row.main_release ? row.main_release : row.id;
  if (!id || id <= 0) return null;

  return {
    id,
    title: row.title,
    artist: row.artist ? cleanArtistName(row.artist) : "Unknown Artist",
    year: row.year && row.year > 0 ? row.year : null,
    thumb: row.thumb ?? "",
    label: row.label ? cleanArtistName(row.label) : null,
  };
}

export async function getArtistReleases(
  user: UserToken,
  artistId: number,
  perPage = 100,
): Promise<RelatedRelease[]> {
  const data = await getJson(
    `/artists/${artistId}/releases?per_page=${perPage}&page=1&sort=year&sort_order=desc`,
    user,
    relatedReleaseSchema,
  );

  return data.releases
    // Skip credits (remixer, producer) — we want records they released.
    .filter((r) => !r.role || r.role === "Main" || r.role === "TrackAppearance")
    .map(toRelated)
    .filter((r): r is RelatedRelease => r !== null);
}

const labelReleaseSchema = z.object({
  pagination: paginationSchema,
  releases: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      year: z.number().nullish(),
      thumb: z.string().nullish(),
      artist: z.string().nullish(),
      catno: z.string().nullish(),
    }),
  ),
});

export async function getLabelReleases(
  user: UserToken,
  labelId: number,
  perPage = 100,
): Promise<RelatedRelease[]> {
  const data = await getJson(
    `/labels/${labelId}/releases?per_page=${perPage}&page=1`,
    user,
    labelReleaseSchema,
  );

  return data.releases.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist ? cleanArtistName(r.artist) : "Unknown Artist",
    year: r.year && r.year > 0 ? r.year : null,
    thumb: r.thumb ?? "",
    label: null,
  }));
}
