import "server-only";
import { randomBytes } from "node:crypto";
import { query, queryOne, tx } from "./db";
import type { Playlist, PlaylistItemRow, TrackMeta } from "./types";

/**
 * Data access.
 *
 * **The authorisation rule of this file:** every statement that touches a
 * user's rows carries `user_id = $1` (or joins through a playlist that does).
 * There is no function here that takes a playlist id without also taking the
 * owner's user id. That is what makes IDOR structurally impossible rather
 * than something we remember to check in each route handler.
 */

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: string;
  username_display: string;
  session_version: number;
}

/**
 * Resolve the Discogs username from the session into our internal user id,
 * creating the row on first sight. The username is the identity Discogs
 * asserted during OAuth; it never comes from client input.
 *
 * Also returns the current `session_version`, which the caller compares
 * against the one sealed into the cookie. Doing both in this single statement
 * is the whole trick behind revocation being free: the request had to touch
 * this row anyway.
 */
export async function ensureUser(
  discogsUsername: string,
): Promise<{ userId: string; sessionVersion: number }> {
  const key = discogsUsername.toLowerCase();

  const row = await queryOne<UserRow>(
    `INSERT INTO users (username_key, username_display)
          VALUES ($1, $2)
     ON CONFLICT (username_key)
       DO UPDATE SET last_seen_at = now(),
                     username_display = EXCLUDED.username_display
       RETURNING id, username_display, session_version`,
    [key, discogsUsername],
  );

  if (!row) throw new Error("failed to upsert user");
  return { userId: row.id, sessionVersion: row.session_version };
}

/**
 * Validate a session and resolve it to a user id.
 *
 * Returns `null` when the sealed version is behind the stored one — meaning
 * the user has since revoked their sessions and this cookie, though
 * cryptographically intact, is dead.
 */
export async function resolveSession(
  discogsUsername: string,
  sessionVersion: number,
): Promise<string | null> {
  const { userId, sessionVersion: current } = await ensureUser(discogsUsername);
  return sessionVersion === current ? userId : null;
}

/**
 * Invalidate every session this user holds, on every device, immediately.
 *
 * This is the kill switch that stateless sessions otherwise lack. It takes
 * effect on the very next request anywhere, including the one that called it,
 * because every authenticated request re-reads this column.
 *
 * Note it does *not* reach into Discogs — the user's OAuth grant there is
 * theirs to revoke from their Discogs settings. What this guarantees is that
 * no cookie previously issued by us can be used to act on their behalf again.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const row = await queryOne<{ session_version: number }>(
    `UPDATE users
        SET session_version = session_version + 1
      WHERE id = $1
      RETURNING session_version`,
    [userId],
  );
  if (!row) throw new Error("no such user");
  return row.session_version;
}

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

interface PlaylistRow {
  id: string;
  name: string;
  notes: string | null;
  visibility: string;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  playlist_id: string;
  position: number;
  clip_key: string;
  release_id: string;
  video_id: string;
  title: string;
  artist: string;
  release_title: string;
  year: number | null;
}

function toPlaylist(row: PlaylistRow, items: PlaylistItemRow[]): Playlist {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    visibility: row.visibility === "unlisted" ? "unlisted" : "private",
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    items: items.map((i) => i.clipKey),
    entries: items,
  };
}

export async function listPlaylists(userId: string): Promise<Playlist[]> {
  const playlists = await query<PlaylistRow>(
    `SELECT id, name, notes, visibility, created_at, updated_at
       FROM playlists
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [userId],
  );

  if (playlists.length === 0) return [];

  // One round trip for every item across every playlist, then group in JS.
  // Cheaper than N queries and the volumes here are small.
  const items = await query<ItemRow>(
    `SELECT i.playlist_id, i.position, i.clip_key, i.release_id, i.video_id,
            i.title, i.artist, i.release_title, i.year
       FROM playlist_items i
       JOIN playlists p ON p.id = i.playlist_id
      WHERE p.user_id = $1
      ORDER BY i.playlist_id, i.position`,
    [userId],
  );

  const grouped = new Map<string, PlaylistItemRow[]>();
  for (const row of items) {
    const list = grouped.get(row.playlist_id) ?? [];
    list.push({
      clipKey: row.clip_key,
      releaseId: Number(row.release_id),
      videoId: row.video_id,
      title: row.title,
      artist: row.artist,
      releaseTitle: row.release_title,
      year: row.year,
      position: row.position,
    });
    grouped.set(row.playlist_id, list);
  }

  return playlists.map((p) => toPlaylist(p, grouped.get(p.id) ?? []));
}

export async function getPlaylist(
  userId: string,
  playlistId: string,
): Promise<Playlist | null> {
  const row = await queryOne<PlaylistRow>(
    `SELECT id, name, notes, visibility, created_at, updated_at
       FROM playlists
      WHERE id = $1 AND user_id = $2`,
    [playlistId, userId],
  );
  if (!row) return null;

  const items = await query<ItemRow>(
    `SELECT playlist_id, position, clip_key, release_id, video_id,
            title, artist, release_title, year
       FROM playlist_items
      WHERE playlist_id = $1
      ORDER BY position`,
    [playlistId],
  );

  return toPlaylist(
    row,
    items.map((i) => ({
      clipKey: i.clip_key,
      releaseId: Number(i.release_id),
      videoId: i.video_id,
      title: i.title,
      artist: i.artist,
      releaseTitle: i.release_title,
      year: i.year,
      position: i.position,
    })),
  );
}

export async function createPlaylist(
  userId: string,
  name: string,
  entries: PlaylistItemRow[] = [],
): Promise<Playlist> {
  return tx(async (client) => {
    const created = await client.query<PlaylistRow>(
      `INSERT INTO playlists (user_id, name)
            VALUES ($1, $2)
         RETURNING id, name, notes, visibility, created_at, updated_at`,
      [userId, name],
    );
    const row = created.rows[0];
    if (!row) throw new Error("insert returned no row");

    if (entries.length > 0) {
      await insertItems(client, row.id, entries);
    }

    return toPlaylist(
      row,
      entries.map((e, i) => ({ ...e, position: i })),
    );
  });
}

interface Queryable {
  query<T extends import("pg").QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * Bulk insert via `unnest`, so a 400-track playlist is one statement rather
 * than 400 round trips. Still fully parameterised.
 */
async function insertItems(
  client: Queryable,
  playlistId: string,
  entries: PlaylistItemRow[],
): Promise<void> {
  if (entries.length === 0) return;

  await client.query(
    `INSERT INTO playlist_items
        (playlist_id, position, clip_key, release_id, video_id,
         title, artist, release_title, year)
     SELECT $1,
            t.position, t.clip_key, t.release_id, t.video_id,
            t.title, t.artist, t.release_title, t.year
       FROM unnest(
              $2::int[], $3::text[], $4::bigint[], $5::text[],
              $6::text[], $7::text[], $8::text[], $9::int[]
            ) AS t(position, clip_key, release_id, video_id,
                   title, artist, release_title, year)`,
    [
      playlistId,
      entries.map((_, i) => i),
      entries.map((e) => e.clipKey),
      entries.map((e) => e.releaseId),
      entries.map((e) => e.videoId),
      entries.map((e) => e.title.slice(0, 400)),
      entries.map((e) => e.artist.slice(0, 400)),
      entries.map((e) => (e.releaseTitle ?? "").slice(0, 400)),
      entries.map((e) => e.year),
    ],
  );
}

export async function renamePlaylist(
  userId: string,
  playlistId: string,
  name: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE playlists
        SET name = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [playlistId, userId, name],
  );
  return rows.length > 0;
}

/**
 * Replace a playlist's contents wholesale. Reorder, add and remove all funnel
 * through here: the client sends the list it wants, we make the table match.
 * Simpler to reason about than incremental position patching, and atomic.
 */
export async function replaceItems(
  userId: string,
  playlistId: string,
  entries: PlaylistItemRow[],
): Promise<boolean> {
  return tx(async (client) => {
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM playlists WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [playlistId, userId],
    );
    if (owned.rows.length === 0) return false;

    await client.query(`DELETE FROM playlist_items WHERE playlist_id = $1`, [
      playlistId,
    ]);
    await insertItems(client, playlistId, entries);
    await client.query(
      `UPDATE playlists SET updated_at = now() WHERE id = $1`,
      [playlistId],
    );
    return true;
  });
}

export async function deletePlaylist(
  userId: string,
  playlistId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING id`,
    [playlistId, userId],
  );
  return rows.length > 0;
}


/* ------------------------------------------------------------------ */
/* Share links                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a share link exposes. Deliberately not a `Playlist`.
 *
 * A separate type so that adding a field to `Playlist` later cannot silently
 * widen what an anonymous reader sees. If this ever needs to carry more, that
 * is an edit here, in a type whose name says who is reading.
 */
export interface SharedPlaylist {
  name: string;
  notes: string | null;
  items: PlaylistItemRow[];
  sharedAt: string;
}

/**
 * Turn sharing on for one playlist, or off.
 *
 * Off sets the token to NULL, which is a permanent revocation: the old link
 * cannot be reinstated, only a new one minted. That is the intended behaviour
 * — "unshare" should mean the link you sent someone is dead, not dormant.
 *
 * Ownership is enforced the usual way, by `user_id` in the WHERE clause, so
 * you can only ever share a playlist that is yours.
 */
export async function setPlaylistShare(
  userId: string,
  playlistId: string,
  shared: boolean,
): Promise<{ shareToken: string | null } | null> {
  const token = shared ? randomBytes(32).toString("base64url") : null;

  const row = await queryOne<{ share_token: string | null }>(
    // $3 is cast explicitly: it appears both as an assigned value and inside a
    // CASE, and with a NULL bound Postgres cannot infer a type from either
    // position — it fails the whole statement with "could not determine data
    // type of parameter $3" rather than treating NULL as text.
    `UPDATE playlists
        SET share_token = $3::text,
            shared_at   = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
            updated_at  = now()
      WHERE id = $1 AND user_id = $2
      RETURNING share_token`,
    [playlistId, userId, token],
  );

  if (!row) return null;
  return { shareToken: row.share_token };
}

/**
 * Read a playlist by its share token.
 *
 * **This is the only function in this file that does not take a user id**, and
 * that is the whole point of the design: the exception is one function, with a
 * name that says what it does, rather than an `if` inside a function that also
 * serves owners. A reviewer looking for "what can an anonymous request reach"
 * has exactly one answer to read.
 *
 * The token *is* the authorisation. It is 32 bytes of CSPRNG output, unique,
 * and revocable by setting it to NULL. Lookup is by exact match on an indexed
 * column, so there is no partial match, no prefix search, and no enumeration:
 * a wrong token returns null, indistinguishable from a revoked one.
 *
 * What comes back is the set list and nothing else — no user id, no username,
 * no other playlist, no handle on the owner's account. A holder of the link
 * learns what is in this playlist and can learn nothing further from it.
 */
export async function getPlaylistByShareToken(
  token: string,
): Promise<SharedPlaylist | null> {
  // Guard before touching the database. The column is CHECK-constrained to
  // exactly 43 characters, so anything else cannot match a real row, and
  // rejecting it here keeps junk out of the query path entirely.
  if (typeof token !== "string" || token.length !== 43) return null;

  const row = await queryOne<{
    id: string;
    name: string;
    notes: string | null;
    shared_at: string;
  }>(
    `SELECT id, name, notes, shared_at
       FROM playlists
      WHERE share_token = $1`,
    [token],
  );
  if (!row) return null;

  const items = await query<ItemRow>(
    `SELECT playlist_id, position, clip_key, release_id, video_id,
            title, artist, release_title, year
       FROM playlist_items
      WHERE playlist_id = $1
      ORDER BY position`,
    [row.id],
  );

  return {
    name: row.name,
    notes: row.notes,
    sharedAt: new Date(row.shared_at).toISOString(),
    items: items.map((i) => ({
      clipKey: i.clip_key,
      releaseId: Number(i.release_id),
      videoId: i.video_id,
      title: i.title,
      artist: i.artist,
      releaseTitle: i.release_title,
      year: i.year,
      position: i.position,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Track metadata (BPM / key catalogue)                                */
/* ------------------------------------------------------------------ */

interface MetaRow {
  clip_key: string;
  bpm: string | null;
  bpm_source: string | null;
  bpm_confidence: number | null;
  musical_key: string | null;
  rating: number | null;
  cue_note: string | null;
}

function toMeta(row: MetaRow): TrackMeta {
  return {
    clipKey: row.clip_key,
    bpm: row.bpm === null ? null : Number(row.bpm),
    bpmSource: (row.bpm_source as TrackMeta["bpmSource"]) ?? null,
    bpmConfidence: row.bpm_confidence,
    musicalKey: row.musical_key,
    rating: row.rating,
    cueNote: row.cue_note,
  };
}

/**
 * Forget a reading entirely, so the next detection can start clean.
 *
 * Necessary because of the precedence rules in `upsertTrackMeta`: an automatic
 * reading only replaces another automatic reading if it is *more confident*.
 * That is right almost always — it stops a tempo measured during a breakdown
 * from overwriting a good one — but it means a confidently wrong reading is
 * unreachable. There was no way to say "that one is wrong, measure it again",
 * only to tap over it by hand.
 *
 * `user_id` is in the WHERE clause, so this can only ever delete your own row;
 * a clip key belonging to someone else deletes nothing and reports nothing.
 */
export async function deleteTrackMeta(
  userId: string,
  clipKey: string,
): Promise<boolean> {
  const rows = await query<{ clip_key: string }>(
    `DELETE FROM track_meta
      WHERE user_id = $1 AND clip_key = $2
      RETURNING clip_key`,
    [userId, clipKey],
  );
  return rows.length > 0;
}

export async function listTrackMeta(userId: string): Promise<TrackMeta[]> {
  const rows = await query<MetaRow>(
    `SELECT clip_key, bpm, bpm_source, bpm_confidence, musical_key, rating, cue_note
       FROM track_meta
      WHERE user_id = $1`,
    [userId],
  );
  return rows.map(toMeta);
}

/**
 * Upsert a batch of BPM readings.
 *
 * Precedence is enforced in SQL, not in the client: a human tap always beats
 * an automatic detection, and a stronger automatic reading beats a weaker one.
 * That means the auto-detector running in the background can never quietly
 * overwrite a value the DJ tapped in by hand.
 */
export async function upsertTrackMeta(
  userId: string,
  entries: TrackMeta[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const rows = await query<{ clip_key: string }>(
    `INSERT INTO track_meta
        (user_id, clip_key, bpm, bpm_source, bpm_confidence,
         musical_key, rating, cue_note, updated_at)
     SELECT $1, t.clip_key, t.bpm, t.bpm_source, t.bpm_confidence,
            t.musical_key, t.rating, t.cue_note, now()
       FROM unnest($2::text[], $3::numeric[], $4::text[], $5::real[],
                   $6::text[], $7::smallint[], $8::text[])
         AS t(clip_key, bpm, bpm_source, bpm_confidence,
              musical_key, rating, cue_note)
     ON CONFLICT (user_id, clip_key) DO UPDATE
        SET bpm = CASE
                    WHEN EXCLUDED.bpm IS NULL THEN track_meta.bpm
                    WHEN track_meta.bpm_source IN ('tap','manual')
                         AND EXCLUDED.bpm_source = 'auto' THEN track_meta.bpm
                    WHEN track_meta.bpm_source = 'auto'
                         AND EXCLUDED.bpm_source = 'auto'
                         AND COALESCE(EXCLUDED.bpm_confidence, 0)
                             < COALESCE(track_meta.bpm_confidence, 0)
                      THEN track_meta.bpm
                    ELSE EXCLUDED.bpm
                  END,
            bpm_source = CASE
                    WHEN EXCLUDED.bpm IS NULL THEN track_meta.bpm_source
                    WHEN track_meta.bpm_source IN ('tap','manual')
                         AND EXCLUDED.bpm_source = 'auto' THEN track_meta.bpm_source
                    WHEN track_meta.bpm_source = 'auto'
                         AND EXCLUDED.bpm_source = 'auto'
                         AND COALESCE(EXCLUDED.bpm_confidence, 0)
                             < COALESCE(track_meta.bpm_confidence, 0)
                      THEN track_meta.bpm_source
                    ELSE EXCLUDED.bpm_source
                  END,
            bpm_confidence = GREATEST(
                    COALESCE(EXCLUDED.bpm_confidence, 0),
                    COALESCE(track_meta.bpm_confidence, 0)),
            musical_key = COALESCE(EXCLUDED.musical_key, track_meta.musical_key),
            rating      = COALESCE(EXCLUDED.rating, track_meta.rating),
            cue_note    = COALESCE(EXCLUDED.cue_note, track_meta.cue_note),
            updated_at  = now()
     RETURNING clip_key`,
    [
      userId,
      entries.map((e) => e.clipKey),
      entries.map((e) => e.bpm),
      entries.map((e) => e.bpmSource),
      entries.map((e) => e.bpmConfidence),
      entries.map((e) => e.musicalKey),
      entries.map((e) => e.rating),
      entries.map((e) => e.cueNote),
    ],
  );

  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Analyses                                                            */
/* ------------------------------------------------------------------ */

interface AnalysisRow {
  profile: unknown;
  recommendations: unknown;
  used_llm: boolean;
  created_at: Date;
}

export async function getCachedAnalysis(
  userId: string,
  playlistId: string,
  fingerprint: string,
): Promise<{
  profile: unknown;
  recommendations: unknown;
  usedLlm: boolean;
  createdAt: number;
} | null> {
  const row = await queryOne<AnalysisRow>(
    `SELECT a.profile, a.recommendations, a.used_llm, a.created_at
       FROM analyses a
       JOIN playlists p ON p.id = a.playlist_id
      WHERE a.playlist_id = $1
        AND a.fingerprint = $2
        AND p.user_id = $3`,
    [playlistId, fingerprint, userId],
  );
  if (!row) return null;

  return {
    profile: row.profile,
    recommendations: row.recommendations,
    usedLlm: row.used_llm,
    createdAt: row.created_at.getTime(),
  };
}

export async function saveAnalysis(params: {
  userId: string;
  playlistId: string;
  fingerprint: string;
  profile: unknown;
  recommendations: unknown;
  usedLlm: boolean;
}): Promise<void> {
  await query(
    `INSERT INTO analyses
        (user_id, playlist_id, fingerprint, profile, recommendations, used_llm)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (playlist_id, fingerprint) DO UPDATE
        SET profile = EXCLUDED.profile,
            recommendations = EXCLUDED.recommendations,
            used_llm = EXCLUDED.used_llm,
            created_at = now()`,
    [
      params.userId,
      params.playlistId,
      params.fingerprint,
      JSON.stringify(params.profile),
      JSON.stringify(params.recommendations),
      params.usedLlm,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export interface UserPrefs {
  /** Deck pitch range as a percentage. 8 = Technics SL-1200. */
  pitchPercent: number;
}

export async function getPrefs(userId: string): Promise<UserPrefs> {
  const row = await queryOne<{ pitch_percent: number }>(
    `SELECT pitch_percent FROM users WHERE id = $1`,
    [userId],
  );
  return { pitchPercent: row?.pitch_percent ?? 8 };
}

export async function setPitchPercent(
  userId: string,
  pitchPercent: number,
): Promise<UserPrefs> {
  // The CHECK constraint on the column is the real guard; clamping here just
  // turns a hostile value into a sane one instead of a 500.
  const clamped = Math.max(1, Math.min(100, Math.round(pitchPercent)));

  const row = await queryOne<{ pitch_percent: number }>(
    `UPDATE users SET pitch_percent = $2 WHERE id = $1 RETURNING pitch_percent`,
    [userId, clamped],
  );
  return { pitchPercent: row?.pitch_percent ?? clamped };
}

/* ------------------------------------------------------------------ */
/* Dig log                                                             */
/* ------------------------------------------------------------------ */

/**
 * Remember which releases have been surfaced while digging, so the feed keeps
 * moving instead of showing the same twelve records every time.
 *
 * Best-effort by design: callers `.catch()` this. A failure to record an
 * impression must never break the dig itself.
 */
export async function recordDigSeen(
  userId: string,
  releaseIds: number[],
  seedId: number,
): Promise<void> {
  if (releaseIds.length === 0) return;
  const unique = [...new Set(releaseIds)].slice(0, 200);

  await query(
    `INSERT INTO dig_log (user_id, release_id, action, seed_id)
     SELECT $1, t.release_id, 'seen', $3
       FROM unnest($2::bigint[]) AS t(release_id)
     ON CONFLICT (user_id, release_id, action) DO NOTHING`,
    [userId, unique, seedId],
  );
}

export async function recordDigAction(
  userId: string,
  releaseId: number,
  action: "previewed" | "wanted" | "dismissed",
): Promise<void> {
  await query(
    `INSERT INTO dig_log (user_id, release_id, action)
          VALUES ($1, $2, $3)
     ON CONFLICT (user_id, release_id, action) DO NOTHING`,
    [userId, releaseId, action],
  );
}

/** Release ids already shown to this user, newest first. */
export async function recentlySeen(
  userId: string,
  limit = 800,
): Promise<number[]> {
  const rows = await query<{ release_id: string }>(
    `SELECT release_id
       FROM dig_log
      WHERE user_id = $1 AND action = 'seen'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => Number(r.release_id));
}

export async function clearDigHistory(userId: string): Promise<void> {
  await query(`DELETE FROM dig_log WHERE user_id = $1 AND action = 'seen'`, [
    userId,
  ]);
}

/* ------------------------------------------------------------------ */
/* LLM budget accounting                                               */
/* ------------------------------------------------------------------ */

export async function recordLlmUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await query(
    `INSERT INTO llm_usage (user_id, input_tokens, output_tokens)
          VALUES ($1, $2, $3)`,
    [userId, inputTokens, outputTokens],
  );
}

export async function outputTokensLast24h(userId: string): Promise<number> {
  const row = await queryOne<{ total: string | null }>(
    `SELECT COALESCE(SUM(output_tokens), 0)::text AS total
       FROM llm_usage
      WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
    [userId],
  );
  return Number(row?.total ?? 0);
}
