/**
 * Shared shapes between the API routes and the browser.
 * Deliberately narrow: we forward only the fields the player needs, never a
 * raw Discogs payload (which carries marketplace data, notes, and other
 * fields the client has no business receiving).
 */

export interface YouTubeVideo {
  /** 11-character YouTube video ID. */
  id: string;
  title: string;
  /** Seconds, when Discogs reports it. */
  duration: number | null;
}

export interface Track {
  /** Discogs tracklist position, e.g. "A1", "3", "B2". */
  position: string;
  title: string;
  /** "3:47" as printed by Discogs, or null. */
  duration: string | null;
  artists: string[];
}

export interface ReleaseSummary {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  genres: string[];
  styles: string[];
  labels: string[];
  formats: string[];
  /** Discogs country of release, when stated. Faceted in the UI. */
  country: string | null;
  /**
   * Discogs entity ids. Kept because the recommendation graph traverses by id
   * — names are ambiguous ("DJ Sprinkles" vs "Terre Thaemlitz") and Discogs
   * disambiguates duplicates with a numeric suffix that would poison a
   * name-based join.
   */
  artistIds: number[];
  labelIds: number[];
  /** ISO timestamp the item was added to the collection, when available. */
  addedAt: string | null;
  /** Discogs thumbnail URL, may be empty. */
  thumb: string;
  coverImage: string;
}

/** Buy signals. Discogs returns these on the release endpoint for free. */
export interface MarketInfo {
  /** Copies listed on the Discogs marketplace right now. */
  forSale: number;
  /** Lowest asking price, in the account's currency. */
  lowestPrice: number | null;
  /** How many people have it / want it — a rough scarcity read. */
  have: number | null;
  want: number | null;
}

/** A summary plus the data that only the release endpoint can provide. */
export interface ReleaseDetail extends ReleaseSummary {
  tracks: Track[];
  videos: YouTubeVideo[];
  /** Free-text release notes. Mined for BPM markings. */
  notes: string | null;
  market: MarketInfo | null;
  /** Server-side epoch ms of when this detail was fetched. */
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/* Digging                                                             */
/* ------------------------------------------------------------------ */

/** Which relationship produced a dig result. Drives the UI grouping. */
export type DigLane =
  | "other-versions"
  | "credits"
  | "same-artist"
  | "same-label"
  | "artist-labels"
  | "same-style"
  | "same-era"
  | "similar-tempo";

export const DIG_LANE_LABELS: Record<DigLane, string> = {
  "other-versions": "Other versions",
  credits: "Credits",
  "same-artist": "More by this artist",
  "same-label": "More on this label",
  "artist-labels": "Labels they've released on",
  "same-style": "Same style",
  "same-era": "Same era",
  "similar-tempo": "Mixable tempo",
};

/** One record surfaced while digging beyond the collection. */
export interface DigResult {
  releaseId: number;
  title: string;
  artist: string;
  year: number | null;
  thumb: string;
  labels: string[];
  styles: string[];
  genres: string[];
  country: string | null;
  lane: DigLane;
  /** Why it surfaced, in words. */
  reason: string;
  have: number | null;
  want: number | null;
  /** Populated on demand when the user asks to preview it. */
  market?: MarketInfo | null;
  discogsUrl: string;
  marketplaceUrl: string;
}

export interface DigResponse {
  seedReleaseId: number;
  lanes: Array<{ lane: DigLane; label: string; results: DigResult[] }>;
  /** Release ids in the user's collection / wantlist, echoed for convenience. */
  fetchedAt: number;
}

/**
 * One playable entry. Because Discogs attaches videos at the *release* level,
 * a playable is a (release, video) pair, optionally resolved to a track when
 * the video title matches a tracklist entry.
 */
/**
 * Why a record in the crate cannot be played.
 *
 * These are not the same thing and must never be reported as each other.
 * `no-audio` is a fact about the record: Discogs holds no YouTube links for
 * this pressing, and no amount of resyncing will change that. `not-loaded` is
 * a fact about us: the sync never managed to fetch the release, so we do not
 * actually know whether it has audio or not.
 *
 * Telling someone Discogs has no audio for a record they can hear perfectly
 * well on Discogs is the kind of confident wrong answer that makes people
 * stop believing the rest of the app.
 */
export type SilenceReason = "no-audio" | "not-loaded" | "loading" | "record-only";
/*
 * `record-only` is a single track from the release's Discogs tracklist that
 * YouTube has no clip for. Unlike the others it is a real, addressable track
 * (key `123:t.B2`): it can go in a playlist and carry a BPM, and the player
 * skips it. You play it from the record.
 *
 * `loading` is the third, and the most temporary: the record is in the
 * listing, but the sync has not reached it yet this session. Tapping one
 * moves it to the front of the queue (client/syncQueue.ts).
 */

export interface Playable {
  /**
   * Stable key: `${releaseId}:${videoId}` for a clip, `${releaseId}:t.<pos>`
   * for a record-only track (lib/clipKey.ts), or `${releaseId}:silent` for a
   * record shown as one row (still loading, or no tracklist).
   */
  key: string;
  releaseId: number;
  /**
   * Null for a record the crate can show but not play. Deliberately nullable
   * rather than an empty string, so that every consumer which would hand this
   * to the player has to say out loud what it does when there isn't one.
   */
  videoId: string | null;
  /** Best available display title. */
  title: string;
  artist: string;
  releaseTitle: string;
  year: number | null;
  genres: string[];
  styles: string[];
  labels: string[];
  thumb: string;
  /** Faceted in the UI, straight from Discogs release metadata. */
  country: string | null;
  formats: string[];
  /** Seconds, if Discogs reported a duration for the video. */
  duration: number | null;
  /** Tracklist position when the video was matched to a track. */
  position: string | null;
  /** BPM from the catalogue, merged in client-side. Null until known. */
  bpm: number | null;
  /**
   * How confident we are that this video is a single track rather than a
   * full-album rip or a DJ mix.
   */
  matchKind: "track" | "release";
  /**
   * Null when this is a real, playable clip. Invariant, pinned by a test:
   * `silence === null` exactly when `videoId !== null`.
   */
  silence: SilenceReason | null;
  /**
   * ISO timestamp this release entered the collection, when Discogs told us.
   *
   * It comes from the *collection* endpoint, which is the only one that knows
   * — `/releases/{id}` describes a pressing rather than your copy of one, so
   * a detail fetched that way always reports null. That is why this is
   * threaded in from the summary index rather than read off the detail.
   */
  addedAt: string | null;
}

/**
 * One stored playlist entry. Denormalised so a playlist renders on a device
 * that has not synced that release yet, and so an export still means something
 * years later if the Discogs release is edited away.
 */
export interface PlaylistItemRow {
  clipKey: string;
  releaseId: number;
  /** Null for a record-only track: in the set, but nothing to play. */
  videoId: string | null;
  title: string;
  artist: string;
  releaseTitle: string;
  year: number | null;
  position: number;
  /**
   * Discogs username of whoever put this record in. Read-only: filled in by
   * the server on the way out, never accepted on the way in (the request
   * schemas are strict and do not have it).
   */
  addedBy?: string | null;
}

/**
 * Playlist visibility.
 *
 * 'private' is the only value the application ever writes, and the only value
 * any read path honours. 'unlisted' exists so that a future share-by-link
 * feature has to be a deliberate, visible change rather than a default that
 * quietly leaked. See db/schema.sql.
 */
export type PlaylistVisibility = "private" | "unlisted";

export interface Playlist {
  id: string;
  name: string;
  notes: string | null;
  visibility: PlaylistVisibility;
  createdAt: number;
  updatedAt: number;
  /** Playable keys, in order. Kept for the existing UI code paths. */
  items: string[];
  /** Full denormalised rows, in order. */
  entries: PlaylistItemRow[];
  /** "owner" for your own playlists, "editor" for one you joined. */
  role: "owner" | "editor";
  /** The owner's Discogs username. */
  owner: string;
  /**
   * Everyone who has joined, by Discogs username, owner excluded. Non-empty
   * means the playlist is being worked on together.
   */
  collaborators: string[];
  /**
   * Owner only: whether the join link is on. Always false for an editor —
   * they have no business knowing, and nothing to do with it.
   */
  joinLinkOn: boolean;
  /** Bumped on every change; an edit names the version it was made against. */
  version: number;
  /**
   * Id of the newest chat message or note from someone *else*, or null.
   * Lets the chat button show a dot for unread messages without loading
   * them — and not for your own.
   */
  lastMessageId: string | null;
}

/** One message in a collaborative playlist's chat. */
export interface ChatMessage {
  /**
   * "text" for something someone wrote; otherwise a note the server left
   * when the set changed or someone joined or left. Notes cannot be posted.
   */
  kind: import("./chat").MessageKind;
  /** What a note is about. Null for a text message. */
  meta: import("./chat").ActivityMeta | null;
  /** Decimal BIGINT, increasing. */
  id: string;
  /** Discogs username, or null if that account no longer exists. */
  author: string | null;
  /** Plain text, already normalised. Shown as text, never as HTML. */
  body: string;
  /** Epoch ms. */
  at: number;
  /** Written by whoever is asking. */
  mine: boolean;
}

export type BpmSource = "tap" | "auto" | "discogs" | "manual";

export interface TrackMeta {
  clipKey: string;
  bpm: number | null;
  bpmSource: BpmSource | null;
  /** 0–1. Only meaningful for `auto`. */
  bpmConfidence: number | null;
  musicalKey: string | null;
  rating: number | null;
  cueNote: string | null;
}

/* ------------------------------------------------------------------ */
/* Playlist analysis                                                   */
/* ------------------------------------------------------------------ */

export interface Weighted {
  name: string;
  count: number;
  share: number;
}

/** The deterministic part: what the playlist actually *is*, from metadata. */
export interface PlaylistProfile {
  trackCount: number;
  releaseCount: number;
  artists: Weighted[];
  labels: Weighted[];
  styles: Weighted[];
  genres: Weighted[];
  countries: Weighted[];
  decades: Weighted[];
  yearRange: { from: number; to: number } | null;
  bpm: {
    known: number;
    median: number | null;
    min: number | null;
    max: number | null;
  };
  /** Labels the playlist's artists released on that the playlist itself misses. */
  adjacentLabels: Weighted[];
}

export interface Recommendation {
  releaseId: number;
  title: string;
  artist: string;
  year: number | null;
  labels: string[];
  styles: string[];
  thumb: string;
  /** Deterministic 0–1 score from the graph traversal. */
  score: number;
  /** Machine-readable reasons, always present. */
  signals: string[];
  /** Prose reason. Present only when the Claude layer ran. */
  reason?: string;
  /** True when the release is already in the user's collection. */
  owned: boolean;
  inWantlist: boolean;
  discogsUrl: string;
}

export interface AnalysisResult {
  profile: PlaylistProfile;
  recommendations: Recommendation[];
  /** Written characterisation. Only when the Claude layer ran. */
  summary: string | null;
  usedLlm: boolean;
  cachedAt: number | null;
}

export interface CollectionPage<T> {
  items: T[];
  page: number;
  pages: number;
  perPage: number;
  total: number;
}

export type Source = "collection" | "wantlist";

export interface SyncState {
  source: Source;
  /** Releases whose detail (tracklist + videos) we have cached. */
  detailed: number;
  /** Releases known to exist in the source. */
  total: number;
  status: "idle" | "listing" | "detailing" | "done" | "error" | "paused";
  message?: string;
  updatedAt: number;
  /**
   * Releases this run is fetching that weren't cached before — new since the
   * last sync, or everything on a first one. Set once the listing is read.
   * Decides between a thin progress line and the full banner, and what the
   * "N new records" message says when the run is done.
   */
  fresh?: number;
}
