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
  /** Discogs thumbnail URL, may be empty. */
  thumb: string;
  coverImage: string;
  /** ISO timestamp the item was added to the collection, when available. */
  addedAt: string | null;
}

/** A summary plus the data that only the release endpoint can provide. */
export interface ReleaseDetail extends ReleaseSummary {
  tracks: Track[];
  videos: YouTubeVideo[];
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
  /** Seconds, if Discogs reported a duration for the video. */
  duration: number | null;
  /** Tracklist position when the video was matched to a track. */
  position: string | null;
  /**
   * How confident we are that this video is a single track rather than a
   * full-album rip or a DJ mix.
   */
  matchKind: "track" | "release";
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Playable keys, in order. */
  items: string[];
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
