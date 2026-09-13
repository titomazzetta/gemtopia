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

/**
 * A signed request that changes state on Discogs.
 *
 * Kept separate from `getJson` so that every write in the codebase is
 * greppable, and so a read helper can never be accidentally handed a
 * mutating method.
 */
async function writeRequest(
  method: "PUT" | "DELETE" | "POST",
  path: string,
  user: UserToken,
): Promise<void> {
  const authorization = buildAuthHeader(method, `${API}${path}`, {
    consumerKey: env.DISCOGS_CONSUMER_KEY,
    consumerSecret: env.DISCOGS_CONSUMER_SECRET,
    token: user.token,
    tokenSecret: user.tokenSecret,
  });

  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 429) {
    throw new DiscogsError(
      "Discogs rate limit reached",
      429,
      Number(response.headers.get("retry-after") ?? "60"),
    );
  }

  // 204 for a successful delete, 201 for an add, 200 for an edit.
  if (!response.ok && response.status !== 204) {
    throw new DiscogsError(
      response.status === 401
        ? "Discogs rejected the stored credentials"
        : `Discogs write failed (${response.status})`,
      response.status,
    );
  }
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
  // Marketplace signals. Discogs returns these on the release endpoint, so
  // "is this buyable right now, and roughly for how much" costs no extra call.
  num_for_sale: z.number().nullish(),
  lowest_price: z.number().nullish(),
  community: z
    .object({
      have: z.number().nullish(),
      want: z.number().nullish(),
    })
    .nullish(),
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
    market: {
      forSale: data.num_for_sale ?? 0,
      lowestPrice: data.lowest_price ?? null,
      have: data.community?.have ?? null,
      want: data.community?.want ?? null,
    },
    tracks,
    videos,
    fetchedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Wantlist writes                                                     */
/* ------------------------------------------------------------------ */

/**
 * Add a release to the signed-in user's wantlist.
 *
 * The username comes from the session, never from a request parameter — the
 * same rule that protects the collection read paths applies to writes, and
 * matters more here because this one changes data on Discogs.
 */
export async function addToWantlist(
  user: UserToken,
  username: string,
  releaseId: number,
): Promise<void> {
  await writeRequest(
    "PUT",
    `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
    user,
  );
}

/**
 * Add a release to the user's collection.
 *
 * Folder 1 is "Uncategorized", the default every Discogs account has. Folder 0
 * is the synthetic "All" view and rejects writes, so it is never a valid
 * target however tempting the id looks.
 *
 * There is deliberately no `removeFromCollection`. Adding is the thing a DJ
 * needs from a phone; removing is rare, destructive, and better done on
 * Discogs itself where you can see what you are deleting. The sign-in page
 * promises this app never removes anything, and the cheapest way to keep a
 * promise is to not write the function.
 */
export async function addToCollection(
  user: UserToken,
  username: string,
  releaseId: number,
): Promise<void> {
  await writeRequest(
    "POST",
    `/users/${encodeURIComponent(username)}/collection/folders/1/releases/${releaseId}`,
    user,
  );
}

export async function removeFromWantlist(
  user: UserToken,
  username: string,
  releaseId: number,
): Promise<void> {
  await writeRequest(
    "DELETE",
    `/users/${encodeURIComponent(username)}/wants/${releaseId}`,
    user,
  );
}

/* ------------------------------------------------------------------ */
/* Database search — digging beyond the collection                     */
/* ------------------------------------------------------------------ */

const searchSchema = z.object({
  pagination: paginationSchema,
  results: z.array(
    z.object({
      id: z.number(),
      type: z.string().nullish(),
      master_id: z.number().nullish(),
      title: z.string(),
      year: z.union([z.string(), z.number()]).nullish(),
      thumb: z.string().nullish(),
      cover_image: z.string().nullish(),
      label: z.array(z.string()).nullish(),
      genre: z.array(z.string()).nullish(),
      style: z.array(z.string()).nullish(),
      country: z.string().nullish(),
      format: z.array(z.string()).nullish(),
      /*
       * The catalogue number is the field a DJ actually reads off a label, and
       * the one that separates twelve near-identical pressings in a result
       * list. Discogs has always returned it; this codebase simply never asked
       * for it, because the recommender did not need it.
       */
      catno: z.string().nullish(),
      /* Parsed for the photo-identification path that will search by it. */
      barcode: z.array(z.string()).nullish(),
      community: z
        .object({ have: z.number().nullish(), want: z.number().nullish() })
        .nullish(),
    }),
  ),
});

export interface SearchHit {
  id: number;
  /** Discogs search titles are "Artist - Title"; split for display. */
  artist: string;
  title: string;
  year: number | null;
  thumb: string;
  labels: string[];
  genres: string[];
  styles: string[];
  country: string | null;
  formats: string[];
  /** Catalogue number, e.g. "PF-045". The strongest human-readable pressing id. */
  catno: string | null;
  barcodes: string[];
  have: number | null;
  want: number | null;
}

export interface SearchParams {
  /** Catalogue number. The highest-signal field on a record you are holding. */
  catno?: string;
  /** EAN/UPC. Near-exact when present — absent on most white labels and promos. */
  barcode?: string;
  /**
   * Track title. Discogs searches tracklists with this, which `q` does not do
   * — a plain query only matches a track name when it happens to also appear
   * in the release title. That gap is the difference between finding the EP a
   * track is on and finding nothing at all.
   */
  track?: string;
  style?: string;
  genre?: string;
  label?: string;
  artist?: string;
  country?: string;
  format?: string;
  /** Discogs accepts a single year or a "1990-1999" range. */
  year?: string;
  query?: string;
  page?: number;
  perPage?: number;
}

export async function searchReleases(
  user: UserToken,
  params: SearchParams,
): Promise<SearchHit[]> {
  const query = new URLSearchParams();
  query.set("type", "release");
  query.set("per_page", String(Math.min(params.perPage ?? 50, 100)));
  query.set("page", String(params.page ?? 1));

  // Only whitelisted keys reach the upstream query string; values are encoded
  // by URLSearchParams, so a hostile style name cannot inject extra params.
  for (const key of [
    "catno",
    "barcode",
    "track",
    "style",
    "genre",
    "label",
    "artist",
    "country",
    "format",
    "year",
  ] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  if (params.query) query.set("q", params.query);

  const data = await getJson(
    `/database/search?${query.toString()}`,
    user,
    searchSchema,
  );

  return data.results.map((row) => {
    const dash = row.title.indexOf(" - ");
    const artist = dash > 0 ? cleanArtistName(row.title.slice(0, dash)) : "";
    const title = dash > 0 ? row.title.slice(dash + 3) : row.title;
    const year =
      typeof row.year === "number"
        ? row.year
        : row.year && /^\d{4}$/.test(row.year)
          ? Number(row.year)
          : null;

    return {
      id: row.id,
      artist: artist || "Various",
      title,
      year: year && year > 0 ? year : null,
      thumb: row.thumb ?? row.cover_image ?? "",
      labels: (row.label ?? []).map(cleanArtistName).slice(0, 4),
      genres: row.genre ?? [],
      styles: row.style ?? [],
      country: row.country ?? null,
      formats: row.format ?? [],
      catno: row.catno?.trim() || null,
      barcodes: (row.barcode ?? []).filter((code) => code.trim().length > 0),
      have: row.community?.have ?? null,
      want: row.community?.want ?? null,
    };
  });
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
