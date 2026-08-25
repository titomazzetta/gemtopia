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

/** A summary plus the data that only the release endpoint can provide. */
export interface ReleaseDetail extends ReleaseSummary {
  tracks: Track[];
  videos: YouTubeVideo[];
  /** Free-text release notes. Mined for BPM markings. */
  notes: string | null;
  /** Server-side epoch ms of when this detail was fetched. */
  fetchedAt: number;
}

/**
 * One playable entry. Because Discogs attaches videos at the *release* level,
 * a playable is a (release, video) pair, optionally resolved to a track when
 * the video title matches a tracklist entry.
 */
export interface Playable {
  /** Stable key: `${releaseId}:${videoId}`. */
  key: string;
  releaseId: number;
  videoId: string;
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
}

/**
 * One stored playlist entry. Denormalised so a playlist renders on a device
 * that has not synced that release yet, and so an export still means something
 * years later if the Discogs release is edited away.
 */
export interface PlaylistItemRow {
  clipKey: string;
  releaseId: number;
  videoId: string;
  title: string;
  artist: string;
  releaseTitle: string;
  year: number | null;
  position: number;
}

export interface Playlist {
  id: string;
  name: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  /** Playable keys, in order. Kept for the existing UI code paths. */
  items: string[];
  /** Full denormalised rows, in order. */
  entries: PlaylistItemRow[];
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
}
