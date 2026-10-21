import "server-only";
import { randomBytes } from "node:crypto";
import { query, queryOne, tx } from "./db";
import { seal, unseal } from "./crypto";
import {
  EnvelopeError,
  newDataKey,
  openMessage,
  sealMessage,
  unwrapDataKey,
  wrapDataKey,
} from "./envelope";
import { chatKeyRing, requireChatKeyRing } from "./chatKeys";
import { copyName } from "./playlistCopy";
import { TAG_ROWS_PER_USER } from "./tags";
import {
  DEFAULT_MEMBER_ROLE,
  MAX_COLLABORATORS,
  carryAddedBy,
  hashJoinToken,
  isJoinToken,
  isMemberRole,
  levelToRemember,
  removalsNotAllowed,
  type MemberRole,
} from "./collab";
import {
  MAX_MESSAGES_KEPT,
  MAX_MESSAGES_PER_MINUTE,
  MESSAGE_PAGE,
  UNREAD_CAP,
  activityNotes,
  cleanLabel,
  diffRecords,
  type ActivityMeta,
  type ActivityNote,
  type MessageKind,
} from "./chat";
import type { ChatMessage, Playlist, PlaylistItemRow, TrackMeta } from "./types";

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
  access_revoked_at: Date | null;
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
): Promise<{ userId: string; sessionVersion: number; revoked: boolean }> {
  const key = discogsUsername.toLowerCase();

  const row = await queryOne<UserRow>(
    `INSERT INTO users (username_key, username_display)
          VALUES ($1, $2)
     ON CONFLICT (username_key)
       DO UPDATE SET last_seen_at = now(),
                     username_display = EXCLUDED.username_display
       RETURNING id, username_display, session_version, access_revoked_at`,
    [key, discogsUsername],
  );

  if (!row) throw new Error("failed to upsert user");
  return {
    userId: row.id,
    sessionVersion: row.session_version,
    revoked: row.access_revoked_at !== null,
  };
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
  const { userId, sessionVersion: current, revoked } = await ensureUser(discogsUsername);
  // Removal bumps the version too, so a removed member's cookies already fail
  // the comparison. Checking the flag as well means that stays true even if
  // some later change forgets to bump.
  if (revoked) return null;
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
/* Invites and members                                                 */
/* ------------------------------------------------------------------ */

/**
 * Look a Discogs account up without creating it.
 *
 * `ensureUser` upserts, which is right for someone already signed in and
 * wrong at the door: under invite-only, merely *asking* whether someone is a
 * member must not make them one. The callback uses this first and only calls
 * `ensureUser` once `admit` has said yes.
 */
export async function findMember(
  discogsUsername: string,
): Promise<{ userId: string; revoked: boolean } | null> {
  const row = await queryOne<{ id: string; access_revoked_at: Date | null }>(
    `SELECT id, access_revoked_at FROM users WHERE username_key = $1`,
    [discogsUsername.toLowerCase()],
  );
  return row ? { userId: row.id, revoked: row.access_revoked_at !== null } : null;
}

/** Unused, unexpired, unrevoked codes this admin holds right now. */
export async function countLiveInvites(adminId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM invite_codes
      WHERE created_by = $1
        AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [adminId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Store a new code (as its hash) that lives `hours` from now.
 *
 * Codes that died more than 30 days ago are swept out on the way, so the
 * table stays small without a cron job. Lifetime is bounded again by the
 * table's CHECK, so a bug upstream cannot mint a week-long code.
 */
export async function createInvite(
  adminId: string,
  codeHash: string,
  hours: number,
): Promise<{ id: string; expiresAt: number }> {
  await query(
    `DELETE FROM invite_codes
      WHERE expires_at < now() - interval '30 days'`,
  );
  const row = await queryOne<{ id: string; expires_at: Date }>(
    `INSERT INTO invite_codes (code_hash, created_by, expires_at)
          VALUES ($1, $2, now() + make_interval(hours => $3))
       RETURNING id, expires_at`,
    [codeHash, adminId, hours],
  );
  if (!row) throw new Error("failed to create invite");
  return { id: row.id, expiresAt: row.expires_at.getTime() };
}

/** Whether a code could be spent right now. Used to fail fast at the door. */
export async function inviteUsable(codeHash: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM invite_codes
      WHERE code_hash = $1
        AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [codeHash],
  );
  return row !== null;
}

/**
 * Spend a code and let this Discogs account in, atomically.
 *
 * The first UPDATE is the single-use guarantee. It only matches a code that
 * is unused, unrevoked and unexpired *at the moment it runs*, and it takes the
 * row lock while doing it. A second redemption of the same code — the same
 * person double-clicking, or a friend-of-a-friend racing them — blocks on that
 * lock, then re-checks the WHERE clause against the committed row, finds
 * `used_at` set, and matches nothing. No code path reads "is it used?" and
 * writes "now it is" as two separate steps.
 *
 * Everything else — creating the member, recording who invited them,
 * lifting a previous removal — happens in the same transaction, so a failure
 * part way leaves the code unspent.
 *
 * Returns null if the code could not be spent, for any reason: the caller
 * does not get to learn *why*, and neither does the person at the door.
 */
export async function redeemInvite(
  codeHash: string,
  discogsUsername: string,
): Promise<{ userId: string; sessionVersion: number } | null> {
  return tx(async (client) => {
    const spent = await client.query<{ id: string; created_by: string | null }>(
      `UPDATE invite_codes
          SET used_at = now()
        WHERE code_hash = $1
          AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, created_by`,
      [codeHash],
    );
    const invite = spent.rows[0];
    if (!invite) return null;

    const user = await client.query<{ id: string; session_version: number }>(
      `INSERT INTO users (username_key, username_display, invited_by)
            VALUES ($1, $2, $3)
       ON CONFLICT (username_key)
         DO UPDATE SET last_seen_at = now(),
                       username_display = EXCLUDED.username_display,
                       access_revoked_at = NULL,
                       invited_by = COALESCE(users.invited_by, EXCLUDED.invited_by)
         RETURNING id, session_version`,
      [discogsUsername.toLowerCase(), discogsUsername, invite.created_by],
    );
    const member = user.rows[0];
    if (!member) throw new Error("failed to create member");

    await client.query(`UPDATE invite_codes SET used_by = $2 WHERE id = $1`, [
      invite.id,
      member.id,
    ]);

    return { userId: member.id, sessionVersion: member.session_version };
  });
}

export interface InviteRow {
  id: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  revokedAt: number | null;
}

/** This admin's codes, newest first. Hashes never leave the database. */
export async function listInvites(adminId: string): Promise<InviteRow[]> {
  const rows = await query<{
    id: string;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
    used_by: string | null;
    revoked_at: Date | null;
  }>(
    `SELECT i.id, i.created_at, i.expires_at, i.used_at, i.revoked_at,
            u.username_display AS used_by
       FROM invite_codes i
       LEFT JOIN users u ON u.id = i.used_by
      WHERE i.created_by = $1
      ORDER BY i.created_at DESC
      LIMIT 50`,
    [adminId],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.getTime(),
    expiresAt: r.expires_at.getTime(),
    usedAt: r.used_at?.getTime() ?? null,
    usedBy: r.used_by,
    revokedAt: r.revoked_at?.getTime() ?? null,
  }));
}

/**
 * Kill an unspent code. Scoped to the admin who made it, like every other
 * write in this file is scoped to its owner. A used code cannot be revoked —
 * it has already done its job; remove the member instead.
 */
export async function revokeInvite(adminId: string, inviteId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE invite_codes
        SET revoked_at = now()
      WHERE id = $1 AND created_by = $2
        AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id`,
    [inviteId, adminId],
  );
  return row !== null;
}

export interface MemberRow {
  id: string;
  username: string;
  joinedAt: number;
  lastSeenAt: number;
  invitedBy: string | null;
  removedAt: number | null;
}

/** Everyone with an account, most recently active first. Admin-only route. */
export async function listMembers(): Promise<MemberRow[]> {
  const rows = await query<{
    id: string;
    username_display: string;
    created_at: Date;
    last_seen_at: Date;
    invited_by: string | null;
    access_revoked_at: Date | null;
  }>(
    `SELECT u.id, u.username_display, u.created_at, u.last_seen_at,
            u.access_revoked_at, inv.username_display AS invited_by
       FROM users u
       LEFT JOIN users inv ON inv.id = u.invited_by
      ORDER BY u.last_seen_at DESC
      LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username_display,
    joinedAt: r.created_at.getTime(),
    lastSeenAt: r.last_seen_at.getTime(),
    invitedBy: r.invited_by,
    removedAt: r.access_revoked_at?.getTime() ?? null,
  }));
}

/**
 * Take someone's access away, effective on their next request.
 *
 * Two things in one statement: the flag stops them signing back in, and the
 * version bump kills every cookie they hold (the same lever as "sign out
 * everywhere"). Their playlists are left alone — this is a door, not a
 * deletion — so a fresh code restores them exactly as they were.
 *
 * Admins are excluded by name in the WHERE clause, so no request can remove
 * the people who hold the keys, including an admin removing themselves.
 */
export async function removeMember(
  userId: string,
  adminKeys: readonly string[],
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE users
        SET access_revoked_at = now(),
            session_version = session_version + 1
      WHERE id = $1
        AND access_revoked_at IS NULL
        AND NOT (username_key = ANY($2::text[]))
      RETURNING id`,
    [userId, adminKeys],
  );
  return row !== null;
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
  version: number;
  is_owner: boolean;
  /** Your level when it isn't yours; null for the owner. */
  my_role: string | null;
  join_link_on: boolean;
  owner: string;
  collaborators: string[] | null;
  member_roles: string[] | null;
  last_message_id: string | null;
  unread: number;
}

interface ItemRow {
  playlist_id: string;
  position: number;
  clip_key: string;
  release_id: string;
  video_id: string | null;
  title: string;
  artist: string;
  release_title: string;
  year: number | null;
  added_by?: string | null;
  bpm?: number | null;
  bpm_by?: string | null;
}

/*
 * The access rules for playlists, as SQL, written once.
 *
 * Before collaboration this was `user_id = $n` everywhere. It is now "you own
 * it, or you are a member of it" — still a condition in the WHERE clause of
 * every statement, still taking the caller's id from the session and never
 * from the request, so a playlist you have no part in still does not exist
 * as far as any query you can cause is concerned.
 *
 * Three of them, by what a member's level allows (lib/roles.ts):
 *   CAN_SEE     any member: read it, play it, chat on it, copy it.
 *   CAN_EDIT    editors and full control: change its records.
 *   CAN_RENAME  full control only.
 * Owner-only operations (delete, share link, join link, who's on it and at
 * what level) keep the stricter `user_id = $n` and use none of these.
 */
const CAN_SEE = (playlist: string, user: string) =>
  `(${playlist}.user_id = ${user} OR EXISTS (
      SELECT 1 FROM playlist_members pm
       WHERE pm.playlist_id = ${playlist}.id AND pm.user_id = ${user}))`;

const CAN_EDIT = (playlist: string, user: string) =>
  `(${playlist}.user_id = ${user} OR EXISTS (
      SELECT 1 FROM playlist_members pm
       WHERE pm.playlist_id = ${playlist}.id AND pm.user_id = ${user}
         AND pm.role IN ('editor', 'full')))`;

const CAN_RENAME = (playlist: string, user: string) =>
  `(${playlist}.user_id = ${user} OR EXISTS (
      SELECT 1 FROM playlist_members pm
       WHERE pm.playlist_id = ${playlist}.id AND pm.user_id = ${user}
         AND pm.role = 'full'))`;

const PLAYLIST_COLUMNS = `
  p.id, p.name, p.notes, p.visibility, p.created_at, p.updated_at, p.version,
  (p.user_id = $1) AS is_owner,
  (SELECT m.role FROM playlist_members m
    WHERE m.playlist_id = p.id AND m.user_id = $1) AS my_role,
  (p.user_id = $1 AND p.collab_token_hash IS NOT NULL) AS join_link_on,
  o.username_display AS owner,
  (SELECT array_agg(u.username_display ORDER BY m.joined_at, m.user_id)
     FROM playlist_members m JOIN users u ON u.id = m.user_id
    WHERE m.playlist_id = p.id) AS collaborators,
  (SELECT array_agg(m.role ORDER BY m.joined_at, m.user_id)
     FROM playlist_members m
    WHERE m.playlist_id = p.id) AS member_roles,
  (SELECT max(c.id)::text FROM playlist_messages c
    WHERE c.playlist_id = p.id
      AND c.author_id IS DISTINCT FROM $1) AS last_message_id,
  (SELECT count(*)::int FROM (
     SELECT 1 FROM playlist_messages c
      WHERE c.playlist_id = p.id
        AND c.author_id IS DISTINCT FROM $1
        AND c.id > COALESCE((SELECT r.last_read_id FROM playlist_reads r
                              WHERE r.playlist_id = p.id AND r.user_id = $1), 0)
      LIMIT ${UNREAD_CAP}) u) AS unread`;

function toEntry(i: ItemRow): PlaylistItemRow {
  return {
    clipKey: i.clip_key,
    releaseId: Number(i.release_id),
    videoId: i.video_id,
    title: i.title,
    artist: i.artist,
    releaseTitle: i.release_title,
    year: i.year,
    position: i.position,
    addedBy: i.added_by ?? null,
    bpm: i.bpm ?? null,
    bpmBy: i.bpm_by ?? null,
  };
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
    // A level this code doesn't know (the CHECK constraint rules it out) reads
    // as the least one, the same way the SQL treats it: fail closed.
    role: row.is_owner ? "owner" : isMemberRole(row.my_role) ? row.my_role : "viewer",
    owner: row.owner,
    collaborators: row.collaborators ?? [],
    members: (row.collaborators ?? []).map((name, i) => {
      const role = row.member_roles?.[i];
      return { name, role: isMemberRole(role) ? role : "viewer" };
    }),
    joinLinkOn: row.join_link_on,
    version: row.version,
    lastMessageId: row.last_message_id,
    unread: row.unread,
  };
}

export async function listPlaylists(userId: string): Promise<Playlist[]> {
  const playlists = await query<PlaylistRow>(
    `SELECT ${PLAYLIST_COLUMNS}
       FROM playlists p
       JOIN users o ON o.id = p.user_id
      WHERE ${CAN_SEE("p", "$1")}
      ORDER BY p.updated_at DESC`,
    [userId],
  );

  if (playlists.length === 0) return [];

  // One round trip for every item across every playlist, then group in JS.
  // Cheaper than N queries and the volumes here are small.
  const items = await query<ItemRow>(
    `SELECT i.playlist_id, i.position, i.clip_key, i.release_id, i.video_id,
            i.title, i.artist, i.release_title, i.year,
            a.username_display AS added_by,
            i.bpm::float8 AS bpm, b.username_display AS bpm_by
       FROM playlist_items i
       JOIN playlists p ON p.id = i.playlist_id
       LEFT JOIN users a ON a.id = i.added_by
       LEFT JOIN users b ON b.id = i.bpm_by
      WHERE ${CAN_SEE("p", "$1")}
      ORDER BY i.playlist_id, i.position`,
    [userId],
  );

  const grouped = new Map<string, PlaylistItemRow[]>();
  for (const row of items) {
    const list = grouped.get(row.playlist_id) ?? [];
    list.push(toEntry(row));
    grouped.set(row.playlist_id, list);
  }

  return playlists.map((p) => toPlaylist(p, grouped.get(p.id) ?? []));
}

export async function getPlaylist(
  userId: string,
  playlistId: string,
): Promise<Playlist | null> {
  const row = await queryOne<PlaylistRow>(
    `SELECT ${PLAYLIST_COLUMNS}
       FROM playlists p
       JOIN users o ON o.id = p.user_id
      WHERE p.id = $2 AND ${CAN_SEE("p", "$1")}`,
    [userId, playlistId],
  );
  if (!row) return null;

  const items = await query<ItemRow>(
    `SELECT i.playlist_id, i.position, i.clip_key, i.release_id, i.video_id,
            i.title, i.artist, i.release_title, i.year,
            a.username_display AS added_by,
            i.bpm::float8 AS bpm, b.username_display AS bpm_by
       FROM playlist_items i
       LEFT JOIN users a ON a.id = i.added_by
       LEFT JOIN users b ON b.id = i.bpm_by
      WHERE i.playlist_id = $1
      ORDER BY i.position`,
    [playlistId],
  );

  return toPlaylist(row, items.map(toEntry));
}

export async function createPlaylist(
  userId: string,
  name: string,
  entries: PlaylistItemRow[] = [],
): Promise<Playlist> {
  const id = await tx(async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO playlists (user_id, name)
            VALUES ($1, $2)
         RETURNING id`,
      [userId, name],
    );
    const row = created.rows[0];
    if (!row) throw new Error("insert returned no row");

    if (entries.length > 0) {
      await insertItems(
        client,
        row.id,
        entries,
        entries.map(() => userId),
      );
    }
    return row.id;
  });

  const playlist = await getPlaylist(userId, id);
  if (!playlist) throw new Error("created playlist not readable");
  return playlist;
}

/**
 * Your own private copy of a playlist you can see — yours, or one you
 * collaborate on — so a sequence can be reworked, or borrowed from, without
 * touching the one everyone else is looking at.
 *
 * Copies the running order and every row, with the set's BPMs and who
 * measured them: transitions in the copy read exactly as they did in the
 * original. Copies nothing else — no collaborators, no join link, no share
 * link, no chat. Every row is credited to the person making the copy, since
 * it's their list now.
 *
 * Access is the same rule as reading it (CAN_EDIT), checked in the same
 * transaction that copies, under a share lock on the source row: an edit in
 * flight finishes first (replaceItems holds FOR UPDATE), and none starts
 * until the copy is done, so the copy is one version of the list. Someone
 * else's playlist is null — a 404 — like everywhere else. The request
 * carries nothing but the id; there is no client-supplied content to trust.
 */
export async function duplicatePlaylist(
  userId: string,
  playlistId: string,
): Promise<Playlist | null> {
  const id = await tx(async (client) => {
    const source = await client.query<{ name: string }>(
      `SELECT p.name FROM playlists p
        WHERE p.id = $2 AND ${CAN_SEE("p", "$1")}
        FOR SHARE OF p`,
      [userId, playlistId],
    );
    const from = source.rows[0];
    if (!from) return null;

    const names = await client.query<{ name: string }>(
      `SELECT p.name FROM playlists p WHERE ${CAN_SEE("p", "$1")}`,
      [userId],
    );
    const created = await client.query<{ id: string }>(
      `INSERT INTO playlists (user_id, name)
            VALUES ($1, $2)
         RETURNING id`,
      [userId, copyName(from.name, names.rows.map((r) => r.name))],
    );
    const row = created.rows[0];
    if (!row) throw new Error("insert returned no row");

    await client.query(
      `INSERT INTO playlist_items
          (playlist_id, position, clip_key, release_id, video_id,
           title, artist, release_title, year, added_by,
           bpm, bpm_source, bpm_by)
       SELECT $1, i.position, i.clip_key, i.release_id, i.video_id,
              i.title, i.artist, i.release_title, i.year, $2,
              i.bpm, i.bpm_source, i.bpm_by
         FROM playlist_items i
        WHERE i.playlist_id = $3`,
      [row.id, userId, playlistId],
    );
    return row.id;
  });

  if (id === null) return null;
  const playlist = await getPlaylist(userId, id);
  if (!playlist) throw new Error("copied playlist not readable");
  return playlist;
}

interface Queryable {
  query<T extends import("pg").QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/** The pool, shaped like a transaction client, for helpers that take either. */
const POOL: Queryable = {
  async query<T extends import("pg").QueryResultRow>(text: string, params?: unknown[]) {
    return { rows: await query<T>(text, params ?? []) };
  },
};

/**
 * Bulk insert via `unnest`, so a 400-track playlist is one statement rather
 * than 400 round trips. Still fully parameterised.
 */
interface SetBpm {
  bpm: string | null;
  source: string | null;
  by: string | null;
}

async function insertItems(
  client: Queryable,
  playlistId: string,
  entries: PlaylistItemRow[],
  addedBy: Array<string | null>,
  /** The set's BPM for each entry, carried across a rewrite; null for new. */
  setBpm: Array<SetBpm | null> = entries.map(() => null),
): Promise<void> {
  if (entries.length === 0) return;

  await client.query(
    `INSERT INTO playlist_items
        (playlist_id, position, clip_key, release_id, video_id,
         title, artist, release_title, year, added_by,
         bpm, bpm_source, bpm_by)
     SELECT $1,
            t.position, t.clip_key, t.release_id, t.video_id,
            t.title, t.artist, t.release_title, t.year, t.added_by,
            t.bpm, t.bpm_source, t.bpm_by
       FROM unnest(
              $2::int[], $3::text[], $4::bigint[], $5::text[],
              $6::text[], $7::text[], $8::text[], $9::int[], $10::uuid[],
              $11::numeric[], $12::text[], $13::uuid[]
            ) AS t(position, clip_key, release_id, video_id,
                   title, artist, release_title, year, added_by,
                   bpm, bpm_source, bpm_by)`,
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
      addedBy,
      setBpm.map((b) => b?.bpm ?? null),
      setBpm.map((b) => b?.source ?? null),
      setBpm.map((b) => b?.by ?? null),
    ],
  );

  // New records bring the BPM the person who added them has logged, so the
  // set knows the tempo the moment it's in — for everyone on it.
  await client.query(
    `UPDATE playlist_items i
        SET bpm = tm.bpm, bpm_source = tm.bpm_source, bpm_by = tm.user_id
       FROM track_meta tm
      WHERE i.playlist_id = $1
        AND i.bpm IS NULL
        AND i.added_by IS NOT NULL
        AND tm.user_id = i.added_by
        AND tm.clip_key = i.clip_key
        AND tm.bpm IS NOT NULL`,
    [playlistId],
  );
}

/** Owner only. A collaborator renaming the set is not a thing that happens. */
export async function renamePlaylist(
  userId: string,
  playlistId: string,
  name: string,
): Promise<boolean> {
  // The owner, or someone they've given full control.
  const rows = await query<{ id: string }>(
    `UPDATE playlists p
        SET name = $3, updated_at = now()
      WHERE p.id = $1 AND ${CAN_RENAME("p", "$2")}
      RETURNING p.id`,
    [playlistId, userId, name],
  );
  return rows.length > 0;
}

export type ReplaceResult = "ok" | "not_found" | "conflict" | "not_yours" | "view_only";

/**
 * Replace a playlist's contents wholesale. Reorder, add and remove all funnel
 * through here: the client sends the list it wants, we make the table match.
 * Simpler to reason about than incremental position patching, and atomic.
 *
 * Owner or collaborator. With more than one person editing, "the list it
 * wants" can be stale — made against a version someone else has since
 * changed. `expectedVersion` is the version the client was looking at; if it
 * is not the current one the edit is refused ("conflict", a 409) rather than
 * silently throwing away the other person's change. The row lock makes the
 * check and the write one step.
 *
 * Who added each record survives the rewrite: see collab.carryAddedBy.
 *
 * A collaborator may take out only records they added; anyone else's stay
 * unless the owner removes them. That is checked here, against the rows as
 * they are under the lock, not against anything the client says it removed
 * ("not_yours", a 403). See collab.removalsNotAllowed.
 */
export async function replaceItems(
  userId: string,
  playlistId: string,
  entries: PlaylistItemRow[],
  expectedVersion?: number,
): Promise<ReplaceResult> {
  return tx(async (client) => {
    const locked = await client.query<{ version: number; is_owner: boolean; role: string | null }>(
      `SELECT p.version, (p.user_id = $2) AS is_owner,
              (SELECT m.role FROM playlist_members m
                WHERE m.playlist_id = p.id AND m.user_id = $2) AS role
         FROM playlists p
        WHERE p.id = $1 AND ${CAN_SEE("p", "$2")}
        FOR UPDATE OF p`,
      [playlistId, userId],
    );
    const current = locked.rows[0];
    if (!current) return "not_found";
    // Someone who can see it but not change it: refused before anything else,
    // under the same lock, so a level changed a moment ago is the one that counts.
    if (!current.is_owner && current.role !== "editor" && current.role !== "full") {
      return "view_only";
    }
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      return "conflict";
    }
    const mayRemoveAny = current.is_owner || current.role === "full";

    const previous = await client.query<{
      clip_key: string;
      added_by: string | null;
      added_by_name: string | null;
      title: string;
      artist: string;
      year: number | null;
      bpm: string | null;
      bpm_source: string | null;
      bpm_by: string | null;
    }>(
      `SELECT i.clip_key, i.added_by, u.username_display AS added_by_name,
              i.title, i.artist, i.year,
              i.bpm::text AS bpm, i.bpm_source, i.bpm_by
         FROM playlist_items i
         LEFT JOIN users u ON u.id = i.added_by
        WHERE i.playlist_id = $1 ORDER BY i.position`,
      [playlistId],
    );
    const credited = previous.rows.map((r) => ({
      clipKey: r.clip_key,
      addedBy: r.added_by,
    }));
    const nextKeys = entries.map((e) => e.clipKey);
    if (removalsNotAllowed(credited, nextKeys, userId, mayRemoveAny) > 0) {
      return "not_yours";
    }
    const addedBy = carryAddedBy(credited, nextKeys, userId);

    await client.query(`DELETE FROM playlist_items WHERE playlist_id = $1`, [
      playlistId,
    ]);
    // The set's BPMs survive the rewrite, matched by record.
    const setBpmByKey = new Map<string, SetBpm>();
    for (const r of previous.rows) {
      if (r.bpm !== null && !setBpmByKey.has(r.clip_key)) {
        setBpmByKey.set(r.clip_key, { bpm: r.bpm, source: r.bpm_source, by: r.bpm_by });
      }
    }
    await insertItems(
      client,
      playlistId,
      entries,
      addedBy,
      entries.map((e) => setBpmByKey.get(e.clipKey) ?? null),
    );
    await client.query(
      `UPDATE playlists SET updated_at = now(), version = version + 1 WHERE id = $1`,
      [playlistId],
    );

    // On a shared set, say what changed in its chat. Reorders say nothing —
    // they happen in drags of one, and would bury the conversation.
    if (await hasCollaborators(client, playlistId)) {
      const { added, removed } = diffRecords(
        previous.rows.map((r) => ({
          clipKey: r.clip_key,
          title: r.title,
          artist: r.artist,
          year: r.year,
          addedBy: r.added_by_name,
        })),
        entries.map((e) => ({
          clipKey: e.clipKey,
          title: e.title,
          artist: e.artist,
          year: e.year,
        })),
      );
      // The BPM the person adding it has measured, if any — the one reading
      // of theirs a collaborator gets to see, because they're sharing it.
      const bpms = new Map<string, number>();
      if (added.length > 0) {
        const rows = await client.query<{ clip_key: string; bpm: string }>(
          `SELECT clip_key, bpm::text AS bpm FROM track_meta
            WHERE user_id = $1 AND clip_key = ANY($2::text[]) AND bpm IS NOT NULL`,
          [userId, added.map((r) => r.clipKey)],
        );
        for (const r of rows.rows) bpms.set(r.clip_key, Number(r.bpm));
      }
      await writeNotes(client, playlistId, userId, activityNotes(added, removed, bpms));
    }
    return "ok";
  });
}

/** Owner only. Deleting takes every collaborator's access with it. */
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
/* Collaboration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Turn the join link on (minting a fresh one) or off. Owner only.
 *
 * Off is permanent for that link, like a share link: turning it back on makes
 * a new one. People already in stay in — the link is how you get in, not
 * what keeps you there. Returns the link token once, on the way out; it is
 * stored only as a hash (for lookup) and sealed (so the owner can copy it
 * again without breaking the copy already sent).
 */
export async function setJoinLink(
  userId: string,
  playlistId: string,
  on: boolean,
): Promise<{ token: string | null } | null> {
  const token = on ? randomBytes(32).toString("base64url") : null;
  const row = await queryOne<{ id: string }>(
    `UPDATE playlists
        SET collab_token_hash = $3::text,
            collab_token_sealed = $4::text,
            updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [playlistId, userId, token ? hashJoinToken(token) : null, token ? seal(token) : null],
  );
  return row ? { token } : null;
}

/** The current join link, for its owner to copy again. Null if it is off. */
export async function getJoinLink(
  userId: string,
  playlistId: string,
): Promise<{ token: string | null } | null> {
  const row = await queryOne<{ collab_token_sealed: string | null }>(
    `SELECT collab_token_sealed FROM playlists WHERE id = $1 AND user_id = $2`,
    [playlistId, userId],
  );
  if (!row) return null;
  const token = row.collab_token_sealed ? unseal<string>(row.collab_token_sealed) : null;
  return { token: isJoinToken(token) ? token : null };
}

export interface JoinPreview {
  playlistId: string;
  name: string;
  owner: string;
  tracks: number;
  collaborators: number;
  /** You already have it: owner, or joined before. */
  alreadyIn: boolean;
}

/**
 * What the join page shows a signed-in member holding a live link.
 *
 * Deliberately small: the name, whose it is, how big. The records themselves
 * are not shown until you have joined — the link is an invitation to work on
 * the set, not a second way to read it.
 */
export async function previewJoin(
  userId: string,
  token: string,
): Promise<JoinPreview | null> {
  if (!isJoinToken(token)) return null;
  const row = await queryOne<{
    id: string;
    name: string;
    owner: string;
    tracks: string;
    collaborators: string;
    already_in: boolean;
  }>(
    `SELECT p.id, p.name, o.username_display AS owner,
            (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = p.id)::text AS tracks,
            (SELECT count(*) FROM playlist_members m WHERE m.playlist_id = p.id)::text AS collaborators,
            ${CAN_SEE("p", "$2")} AS already_in
       FROM playlists p
       JOIN users o ON o.id = p.user_id
      WHERE p.collab_token_hash = $1`,
    [hashJoinToken(token), userId],
  );
  if (!row) return null;
  return {
    playlistId: row.id,
    name: row.name,
    owner: row.owner,
    tracks: Number(row.tracks),
    collaborators: Number(row.collaborators),
    alreadyIn: row.already_in,
  };
}

export type JoinResult =
  | { status: "joined" | "already"; playlistId: string }
  | { status: "full" }
  | null;

/**
 * Join a playlist through its link — only ever as a result of the person
 * pressing Join themselves. The playlist row is locked so the member cap
 * cannot be overshot by two people joining at once.
 */
export async function joinPlaylist(userId: string, token: string): Promise<JoinResult> {
  if (!isJoinToken(token)) return null;
  return tx(async (client) => {
    const found = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM playlists WHERE collab_token_hash = $1 FOR UPDATE`,
      [hashJoinToken(token)],
    );
    const playlist = found.rows[0];
    if (!playlist) return null;
    if (playlist.user_id === userId) return { status: "already", playlistId: playlist.id };

    const counted = await client.query<{ n: string; mine: boolean }>(
      `SELECT count(*)::text AS n, bool_or(user_id = $2) AS mine
         FROM playlist_members WHERE playlist_id = $1`,
      [playlist.id, userId],
    );
    const { n, mine } = counted.rows[0] ?? { n: "0", mine: false };
    if (mine) return { status: "already", playlistId: playlist.id };
    if (Number(n) >= MAX_COLLABORATORS) return { status: "full" };

    // The level they had if they were on it before (a listener stays a
    // listener), else what joining gives. See playlist_member_levels.
    await client.query(
      `INSERT INTO playlist_members (playlist_id, user_id, role)
       VALUES ($1, $2, COALESCE(
         (SELECT l.role FROM playlist_member_levels l
           WHERE l.playlist_id = $1 AND l.user_id = $2),
         $3))
       ON CONFLICT DO NOTHING`,
      [playlist.id, userId, DEFAULT_MEMBER_ROLE],
    );
    await client.query(
      `DELETE FROM playlist_member_levels WHERE playlist_id = $1 AND user_id = $2`,
      [playlist.id, userId],
    );
    await client.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [
      playlist.id,
    ]);
    await writeNotes(client, playlist.id, userId, [
      { kind: "joined", body: "joined the playlist", meta: {} },
    ]);
    return { status: "joined", playlistId: playlist.id };
  });
}

/**
 * Take someone off a playlist.
 *
 * The owner can remove any collaborator; a collaborator can remove only
 * themselves (leaving). Nobody can remove the owner — there is no row to
 * delete, the owner is not a member, they are the owner. Anyone else asking
 * gets the same "no such thing" as for a playlist they cannot see.
 */
export async function removeCollaborator(
  actorId: string,
  playlistId: string,
  username: string,
): Promise<boolean> {
  return tx(async (client) => {
    const deleted = await client.query<{ id: string; role: string }>(
      `DELETE FROM playlist_members m
        USING playlists p, users u
        WHERE m.playlist_id = p.id
          AND m.user_id = u.id
          AND p.id = $1
          AND u.username_key = lower($3)
          AND (p.user_id = $2 OR m.user_id = $2)
        RETURNING m.user_id AS id, m.role`,
      [playlistId, actorId, username],
    );
    const gone = deleted.rows[0];
    if (!gone) return false;
    // A restriction outlives leaving, so coming back through the link can't
    // be a way round it; a grant (full control) doesn't come back that way.
    // roles.levelToRemember says which.
    const keep = isMemberRole(gone.role) ? levelToRemember(gone.role) : null;
    if (keep) {
      await client.query(
        `INSERT INTO playlist_member_levels (playlist_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [playlistId, gone.id, keep],
      );
    }
    await client.query(
      `DELETE FROM playlist_reads WHERE playlist_id = $1 AND user_id = $2`,
      [playlistId, gone.id],
    );
    // Signed by the person who is gone, so it reads "komron left"; `removed`
    // says the owner did it.
    const removed = gone.id !== actorId;
    await writeNotes(client, playlistId, gone.id, [
      {
        kind: "left",
        body: removed ? "was taken off the playlist" : "left the playlist",
        meta: { removed },
      },
    ]);
    return true;
  });
}

export type SetRoleResult = "ok" | "unchanged" | "not_found";

/** How a change of level reads in the chat, as plain text (the client draws its own line). */
const ROLE_NOTE: Record<MemberRole, (name: string) => string> = {
  viewer: (name) => `made ${name} a listener — they can play and chat, not change the set`,
  editor: (name) => `let ${name} add records and take out their own`,
  full: (name) => `gave ${name} full control of what's in the set`,
};

/**
 * The owner sets what one person on their set may do (lib/roles.ts).
 *
 * Owner only, by construction: the row is found through `p.user_id = $2`, so
 * a member or a stranger asking changes nothing and gets the same 404 as for
 * a playlist they can't see. The owner isn't a member and has no level to
 * change. The member row is locked, so the change and its note are one step;
 * replaceItems reads the level under the playlist's lock, so an edit already
 * in flight finishes under the old level and the next one meets the new.
 *
 * A change is said in the set's chat, signed by the owner, so everyone on it
 * knows who can take out what. Setting the level someone already has is a
 * no-op, and says nothing.
 */
export async function setMemberRole(
  ownerId: string,
  playlistId: string,
  username: string,
  role: MemberRole,
): Promise<SetRoleResult> {
  return tx(async (client) => {
    const found = await client.query<{ user_id: string; role: string; name: string }>(
      `SELECT m.user_id, m.role, u.username_display AS name
         FROM playlist_members m
         JOIN playlists p ON p.id = m.playlist_id
         JOIN users u ON u.id = m.user_id
        WHERE p.id = $1 AND p.user_id = $2 AND u.username_key = lower($3)
        FOR UPDATE OF m`,
      [playlistId, ownerId, username],
    );
    const member = found.rows[0];
    if (!member) return "not_found";
    if (member.role === role) return "unchanged";
    await client.query(
      `UPDATE playlist_members SET role = $3 WHERE playlist_id = $1 AND user_id = $2`,
      [playlistId, member.user_id, role],
    );
    const name = cleanLabel(member.name, 64);
    await writeNotes(client, playlistId, ownerId, [
      { kind: "role", body: ROLE_NOTE[role](name), meta: { member: name, role } },
    ]);
    return "ok";
  });
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

/* ------------------------------------------------------------------ */
/* Chat on collaborative playlists                                     */
/* ------------------------------------------------------------------ */

interface MessageRow {
  id: string;
  kind: MessageKind;
  /** Legacy plaintext columns: only rows written before encryption have them. */
  meta: ActivityMeta | null;
  body: string | null;
  /** version ‖ iv ‖ ciphertext ‖ tag; see lib/envelope.ts. */
  sealed: Buffer | null;
  author_id: string | null;
  created_at: Date;
  author: string | null;
  mine: boolean;
}

/** What a reader sees in place of a message that fails its integrity check. */
export const UNREADABLE_MESSAGE = "This message can't be shown: it failed its integrity check.";

/* ---- chat keys (envelope encryption, lib/envelope.ts) --------------- */

interface ChatKeyRow {
  kek_id: string;
  wrapped_key: Buffer;
}

async function readChatKeyRow(client: Queryable, playlistId: string): Promise<ChatKeyRow | null> {
  const { rows } = await client.query<ChatKeyRow>(
    `SELECT kek_id, wrapped_key FROM playlist_chat_keys WHERE playlist_id = $1`,
    [playlistId],
  );
  return rows[0] ?? null;
}

/**
 * The playlist's chat key if it has one, for reading. Never creates one. Null
 * when there is no key yet, no master key configured, or the stored key won't
 * unwrap — the caller shows sealed messages as unreadable either way.
 */
async function existingChatKey(client: Queryable, playlistId: string): Promise<Buffer | null> {
  const ring = chatKeyRing();
  if (!ring) return null;
  const row = await readChatKeyRow(client, playlistId);
  if (!row) return null;
  try {
    return unwrapDataKey(ring, row.kek_id, playlistId, row.wrapped_key);
  } catch (error) {
    console.error(`[chat] key for playlist ${playlistId} does not unwrap (${(error as Error).message})`);
    return null;
  }
}

/**
 * The playlist's chat key, made on first use. Callers have already checked
 * the person may write here. Two first posts racing is fine: ON CONFLICT
 * keeps one key, and the loser reads the winner's.
 *
 * A stored key that won't unwrap throws rather than being replaced, because
 * a new key would silently orphan every message the old one sealed.
 */
async function chatKey(client: Queryable, playlistId: string): Promise<Buffer> {
  const ring = requireChatKeyRing();
  const row = await readChatKeyRow(client, playlistId);
  if (row) return unwrapDataKey(ring, row.kek_id, playlistId, row.wrapped_key);

  const dataKey = newDataKey();
  const inserted = await client.query<{ playlist_id: string }>(
    `INSERT INTO playlist_chat_keys (playlist_id, kek_id, wrapped_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (playlist_id) DO NOTHING
     RETURNING playlist_id`,
    [playlistId, ring.current.id, wrapDataKey(ring.current, playlistId, dataKey)],
  );
  if (inserted.rows.length === 1) return dataKey;

  dataKey.fill(0);
  const winner = await readChatKeyRow(client, playlistId);
  if (!winner) throw new Error("chat key disappeared while being created");
  return unwrapDataKey(ring, winner.kek_id, playlistId, winner.wrapped_key);
}

/** Ids for rows about to be inserted, so each can be sealed to its own id. */
async function nextMessageIds(client: Queryable, count: number): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT nextval(pg_get_serial_sequence('playlist_messages', 'id'))::text AS id
       FROM generate_series(1, $1::int)`,
    [count],
  );
  return rows.map((r) => r.id);
}

function toMessage(row: MessageRow, playlistId: string, dataKey: Buffer | null): ChatMessage {
  const base = {
    id: row.id,
    author: row.author,
    at: row.created_at.getTime(),
    mine: row.mine,
  };

  // Written before encryption, and not yet re-sealed by the admin backfill.
  if (!row.sealed) {
    return { ...base, kind: row.kind, meta: row.meta, body: row.body ?? "" };
  }

  try {
    if (!dataKey) throw new EnvelopeError("no key");
    const payload = openMessage(
      dataKey,
      { playlistId, messageId: row.id, kind: row.kind },
      row.author_id,
      row.sealed,
    );
    return { ...base, kind: row.kind, meta: payload.m as ActivityMeta | null, body: payload.b };
  } catch (error) {
    // Logged without content — there is none to log — and shown as one
    // unreadable line rather than failing the whole page.
    console.error(`[chat] message ${row.id} in ${playlistId} did not verify (${(error as Error).message})`);
    return { ...base, kind: "text", meta: null, body: UNREADABLE_MESSAGE, unreadable: true };
  }
}

/**
 * A page of a playlist's chat, newest first: the latest page, or the page
 * before `before`. Owner or collaborator; anyone else gets null (a 404), the
 * same answer as for a playlist that does not exist.
 *
 * Polling reads the latest page again rather than "everything after id N":
 * it picks up deletions for free, and it cannot miss a message that
 * committed out of id order.
 *
 * Messages are decrypted here, server-side, after the access check — the
 * database only ever returns ciphertext for them.
 */
export async function listMessages(
  userId: string,
  playlistId: string,
  before: string | null,
): Promise<{ messages: ChatMessage[]; hasMore: boolean } | null> {
  const access = await queryOne<{ id: string }>(
    `SELECT p.id FROM playlists p WHERE p.id = $1 AND ${CAN_SEE("p", "$2")}`,
    [playlistId, userId],
  );
  if (!access) return null;

  const rows = await query<MessageRow>(
    `SELECT m.id::text AS id, m.kind, m.meta, m.body, m.sealed,
            m.author_id::text AS author_id, m.created_at,
            u.username_display AS author,
            (m.author_id IS NOT DISTINCT FROM $2::uuid) AS mine
       FROM playlist_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.playlist_id = $1
        AND ($3::bigint IS NULL OR m.id < $3::bigint)
      ORDER BY m.id DESC
      LIMIT $4`,
    [playlistId, userId, before, MESSAGE_PAGE + 1],
  );

  const page = rows.slice(0, MESSAGE_PAGE);
  const dataKey = page.some((r) => r.sealed)
    ? await existingChatKey(POOL, playlistId)
    : null;
  try {
    return {
      messages: page.map((row) => toMessage(row, playlistId, dataKey)),
      hasMore: rows.length > MESSAGE_PAGE,
    };
  } finally {
    dataKey?.fill(0);
  }
}

export type PostResult =
  | { status: "ok"; message: ChatMessage }
  | { status: "not_found" }
  | { status: "too_fast" };

/**
 * Post a message. `body` must already be normalised (chat.normaliseMessage).
 *
 * The text is sealed before it reaches the database: AES-256-GCM under the
 * playlist's own key, bound to this playlist, this message id and its kind.
 * The id is taken from the sequence first so it can be part of that binding.
 *
 * The access condition is still inside the INSERT itself, so there is no
 * window between "may they?" and "they did". The per-person limit is counted
 * in the database, so it holds however many serverless instances are running.
 */
export async function postMessage(
  userId: string,
  playlistId: string,
  body: string,
): Promise<PostResult> {
  // Refuse before touching anything if this deployment can't encrypt:
  // never fall back to storing the message in plaintext.
  requireChatKeyRing();

  const access = await queryOne<{ id: string }>(
    `SELECT p.id FROM playlists p WHERE p.id = $1 AND ${CAN_SEE("p", "$2")}`,
    [playlistId, userId],
  );
  if (!access) return { status: "not_found" };

  const recent = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM playlist_messages
      WHERE author_id = $1 AND kind = 'text'
        AND created_at > now() - interval '1 minute'`,
    [userId],
  );
  if ((recent?.n ?? 0) >= MAX_MESSAGES_PER_MINUTE) return { status: "too_fast" };

  const dataKey = await chatKey(POOL, playlistId);
  let row: MessageRow | null;
  try {
    const [id] = await nextMessageIds(POOL, 1);
    const sealed = sealMessage(
      dataKey,
      { playlistId, messageId: id!, kind: "text" },
      { a: userId, b: body, m: null },
    );
    row = await queryOne<MessageRow>(
      `WITH inserted AS (
         INSERT INTO playlist_messages (id, playlist_id, author_id, sealed)
         OVERRIDING SYSTEM VALUE
         SELECT $4::bigint, p.id, $2, $3
           FROM playlists p
          WHERE p.id = $1 AND ${CAN_SEE("p", "$2")}
         RETURNING id, kind, created_at
       )
       SELECT i.id::text AS id, i.kind, NULL::jsonb AS meta, NULL::text AS body,
              NULL::bytea AS sealed, $2::text AS author_id, i.created_at,
              u.username_display AS author, true AS mine
         FROM inserted i
         JOIN users u ON u.id = $2`,
      [playlistId, userId, sealed, id],
    );
  } finally {
    dataKey.fill(0);
  }
  if (!row) return { status: "not_found" };

  await query(PRUNE_MESSAGES, [playlistId, MAX_MESSAGES_KEPT]);
  // We hold the plaintext already; nothing to decrypt.
  return {
    status: "ok",
    message: {
      id: row.id,
      kind: "text",
      meta: null,
      author: row.author,
      body,
      at: row.created_at.getTime(),
      mine: true,
    },
  };
}

/**
 * Keep the newest MAX_MESSAGES_KEPT of a playlist's chat. Cheap on the
 * (playlist_id, id) index, and a no-op until a chat is that long.
 */
const PRUNE_MESSAGES = `
  DELETE FROM playlist_messages
   WHERE playlist_id = $1
     AND id <= (SELECT id FROM playlist_messages
                 WHERE playlist_id = $1
                 ORDER BY id DESC
                 OFFSET $2 LIMIT 1)`;

/**
 * Leave activity notes in a playlist's chat, inside the caller's transaction.
 * `kind` and `meta` are only ever written here, from what the server holds —
 * there is no path from a request body to either. Sealed exactly like
 * messages: the record titles in a note are as private as the chat.
 *
 * Without a master key the notes are skipped (and logged), not written in
 * plaintext — and the edit they describe still goes through.
 */
async function writeNotes(
  client: Queryable,
  playlistId: string,
  authorId: string,
  notes: readonly ActivityNote[],
): Promise<void> {
  if (notes.length === 0) return;
  if (!chatKeyRing()) {
    console.error(`[chat] ${notes.length} note(s) for ${playlistId} skipped: no CHAT_MASTER_KEY`);
    return;
  }

  const dataKey = await chatKey(client, playlistId);
  try {
    const ids = await nextMessageIds(client, notes.length);
    const sealed = notes.map((note, i) =>
      sealMessage(
        dataKey,
        { playlistId, messageId: ids[i]!, kind: note.kind },
        { a: authorId, b: note.body, m: note.meta as unknown as Record<string, unknown> },
      ),
    );
    await client.query(
      `INSERT INTO playlist_messages (id, playlist_id, author_id, kind, sealed)
       OVERRIDING SYSTEM VALUE
       SELECT n.id, $1, $2, n.kind, n.sealed
         FROM unnest($3::bigint[], $4::text[], $5::bytea[]) AS n(id, kind, sealed)`,
      [playlistId, authorId, ids, notes.map((n) => n.kind), sealed],
    );
  } finally {
    dataKey.fill(0);
  }
  await client.query(PRUNE_MESSAGES, [playlistId, MAX_MESSAGES_KEPT]);
}

/** True when anyone besides the owner is on the playlist — someone to tell. */
async function hasCollaborators(client: Queryable, playlistId: string): Promise<boolean> {
  const rows = await client.query<{ one: number }>(
    `SELECT 1 AS one FROM playlist_members WHERE playlist_id = $1 LIMIT 1`,
    [playlistId],
  );
  return rows.rows.length > 0;
}

/**
 * Mark a playlist's chat read up to a message, for the person asking. Owner
 * or collaborator (the access condition is in the INSERT … SELECT); moves
 * forward only, and never past the newest message there is, whatever the
 * client sends. Returns false — a 404 — for a playlist you can't see.
 */
export async function markChatRead(
  userId: string,
  playlistId: string,
  upTo: string,
): Promise<boolean> {
  const row = await queryOne<{ last_read_id: string }>(
    `INSERT INTO playlist_reads (playlist_id, user_id, last_read_id)
     SELECT p.id, $2,
            LEAST($3::bigint, COALESCE((SELECT max(m.id) FROM playlist_messages m
                                         WHERE m.playlist_id = p.id), 0))
       FROM playlists p
      WHERE p.id = $1 AND ${CAN_SEE("p", "$2")}
     ON CONFLICT (playlist_id, user_id) DO UPDATE
        SET last_read_id = GREATEST(playlist_reads.last_read_id, EXCLUDED.last_read_id),
            read_at = now()
     RETURNING last_read_id::text`,
    [playlistId, userId, upTo],
  );
  return row !== null;
}

/**
 * Delete one message: your own, or any on a playlist you own. Everything is
 * in the WHERE clause — the message, its playlist, your access to that
 * playlist, and your right to this message — so any other combination
 * deletes nothing and is a 404.
 */
export async function deleteMessage(
  userId: string,
  playlistId: string,
  messageId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM playlist_messages m
      USING playlists p
      WHERE m.id = $3::bigint
        AND m.playlist_id = $1
        AND p.id = m.playlist_id
        AND ${CAN_SEE("p", "$2")}
        AND (m.author_id = $2 OR p.user_id = $2)
      RETURNING m.id::text AS id`,
    [playlistId, userId, messageId],
  );
  return rows.length > 0;
}

/* ---- encryption administration (admin panel → Encryption) ---------- */

export interface EncryptionStatus {
  /** CHAT_MASTER_KEY is set on this deployment. */
  configured: boolean;
  /** Public id of the current master key (an HMAC fingerprint, not the key). */
  currentKeyId: string | null;
  /** Retired master keys still configured for unwrapping. */
  retiredKeyIds: string[];
  messages: { sealed: number; plaintext: number };
  playlistKeys: { total: number; current: number; retired: number; missing: number };
  /** The database itself refuses a message without ciphertext. */
  plaintextRefused: boolean;
}

export async function encryptionStatus(): Promise<EncryptionStatus> {
  const ring = chatKeyRing();
  const counts = await queryOne<{ sealed: number; plaintext: number }>(
    `SELECT count(*) FILTER (WHERE sealed IS NOT NULL)::int AS sealed,
            count(*) FILTER (WHERE sealed IS NULL)::int AS plaintext
       FROM playlist_messages`,
  );
  const keys = await query<{ kek_id: string; n: number }>(
    `SELECT kek_id, count(*)::int AS n FROM playlist_chat_keys GROUP BY kek_id`,
  );
  const locked = await queryOne<{ on: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'playlist_messages_sealed_required') AS on`,
  );

  const playlistKeys = { total: 0, current: 0, retired: 0, missing: 0 };
  for (const { kek_id, n } of keys) {
    playlistKeys.total += n;
    if (ring && kek_id === ring.current.id) playlistKeys.current += n;
    else if (ring?.byId.has(kek_id)) playlistKeys.retired += n;
    else playlistKeys.missing += n;
  }

  return {
    configured: Boolean(ring),
    currentKeyId: ring?.current.id ?? null,
    retiredKeyIds: ring ? [...ring.byId.keys()].filter((id) => id !== ring.current.id) : [],
    messages: { sealed: counts?.sealed ?? 0, plaintext: counts?.plaintext ?? 0 },
    playlistKeys,
    plaintextRefused: locked?.on ?? false,
  };
}

/**
 * Seal messages written before encryption existed, in place, in batches.
 * Each batch is one transaction that locks its rows (SKIP LOCKED, so two
 * admins clicking at once share the work rather than colliding), seals each
 * row to its own id, and clears the plaintext columns in the same UPDATE —
 * there is no moment where a row has neither or both.
 *
 * Stops after `budgetMs` so one request stays well inside a serverless time
 * limit; the panel calls again until nothing is left.
 */
export async function sealOlderMessages(budgetMs = 4_000): Promise<{ sealed: number; remaining: number }> {
  requireChatKeyRing();
  const started = Date.now();
  let sealedCount = 0;

  while (Date.now() - started < budgetMs) {
    const done = await tx(async (client) => {
      const { rows } = await client.query<{
        id: string;
        playlist_id: string;
        author_id: string | null;
        kind: MessageKind;
        body: string | null;
        meta: ActivityMeta | null;
      }>(
        `SELECT id::text AS id, playlist_id, author_id::text AS author_id, kind, body, meta
           FROM playlist_messages
          WHERE sealed IS NULL
          ORDER BY id
          LIMIT 200
          FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return 0;

      const keys = new Map<string, Buffer>();
      try {
        const ids: string[] = [];
        const blobs: Buffer[] = [];
        for (const row of rows) {
          let dataKey = keys.get(row.playlist_id);
          if (!dataKey) {
            dataKey = await chatKey(client, row.playlist_id);
            keys.set(row.playlist_id, dataKey);
          }
          ids.push(row.id);
          blobs.push(
            sealMessage(
              dataKey,
              { playlistId: row.playlist_id, messageId: row.id, kind: row.kind },
              {
                a: row.author_id,
                b: row.body ?? "",
                m: (row.meta as unknown as Record<string, unknown> | null) ?? null,
              },
            ),
          );
        }
        await client.query(
          `UPDATE playlist_messages m
              SET sealed = u.sealed, body = NULL, meta = NULL
             FROM unnest($1::bigint[], $2::bytea[]) AS u(id, sealed)
            WHERE m.id = u.id AND m.sealed IS NULL`,
          [ids, blobs],
        );
      } finally {
        for (const key of keys.values()) key.fill(0);
      }
      return rows.length;
    });
    if (done === 0) break;
    sealedCount += done;
  }

  const left = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM playlist_messages WHERE sealed IS NULL`,
  );
  return { sealed: sealedCount, remaining: left?.n ?? 0 };
}

/**
 * Re-wrap every playlist key under the current master key. Run after
 * rotating CHAT_MASTER_KEY (the old one moved to CHAT_MASTER_KEY_PREVIOUS).
 * Touches one small row per playlist; no message is decrypted or rewritten.
 * When it reports nothing remaining, the old key can be deleted from the
 * host — and from then on, old backups are unreadable too.
 */
export async function rewrapChatKeys(): Promise<{ rewrapped: number; remaining: number; missing: number }> {
  const ring = requireChatKeyRing();
  const rewrapped = await tx(async (client) => {
    const { rows } = await client.query<{ playlist_id: string; kek_id: string; wrapped_key: Buffer }>(
      `SELECT playlist_id, kek_id, wrapped_key
         FROM playlist_chat_keys
        WHERE kek_id <> $1
        ORDER BY playlist_id
        LIMIT 1000
        FOR UPDATE SKIP LOCKED`,
      [ring.current.id],
    );
    let count = 0;
    for (const row of rows) {
      if (!ring.byId.has(row.kek_id)) continue; // reported as missing below
      const dataKey = unwrapDataKey(ring, row.kek_id, row.playlist_id, row.wrapped_key);
      try {
        await client.query(
          `UPDATE playlist_chat_keys
              SET kek_id = $3, wrapped_key = $4, rewrapped_at = now()
            WHERE playlist_id = $1 AND kek_id = $2`,
          [row.playlist_id, row.kek_id, ring.current.id, wrapDataKey(ring.current, row.playlist_id, dataKey)],
        );
        count += 1;
      } finally {
        dataKey.fill(0);
      }
    }
    return count;
  });

  const left = await query<{ kek_id: string; n: number }>(
    `SELECT kek_id, count(*)::int AS n FROM playlist_chat_keys WHERE kek_id <> $1 GROUP BY kek_id`,
    [ring.current.id],
  );
  let remaining = 0;
  let missing = 0;
  for (const { kek_id, n } of left) {
    if (ring.byId.has(kek_id)) remaining += n;
    else missing += n;
  }
  return { rewrapped, remaining, missing };
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
  // A reading you take back comes off the sets you gave it to. Someone
  // else's reading of the same record stays where it is.
  await query(
    `UPDATE playlist_items
        SET bpm = NULL, bpm_source = NULL, bpm_by = NULL
      WHERE clip_key = $2 AND bpm_by = $1`,
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

  await shareBpmWithSets(userId, entries.filter((e) => e.bpm !== null).map((e) => e.clipKey));
  return rows.length;
}

/**
 * Copy what you just logged onto every playlist you're on that holds those
 * records, as that set's BPM — so a back-to-back partner sees it, and keeps
 * seeing it whether or not they own the record or you later leave.
 *
 * Reads the catalogue row as it stands after the upsert (which has already
 * applied tap-beats-auto for you), then the same rule between people: the
 * latest reading wins, except that an auto-detected one never replaces
 * someone's tap or typed value. Your own earlier reading is always yours to
 * replace. Only playlists you can edit (CAN_EDIT); nobody else's.
 */
async function shareBpmWithSets(userId: string, clipKeys: string[]): Promise<void> {
  if (clipKeys.length === 0) return;
  await query(
    `UPDATE playlist_items i
        SET bpm = tm.bpm, bpm_source = tm.bpm_source, bpm_by = $1
       FROM track_meta tm, playlists p
      WHERE tm.user_id = $1
        AND tm.clip_key = ANY($2::text[])
        AND tm.bpm IS NOT NULL
        AND i.clip_key = tm.clip_key
        AND p.id = i.playlist_id
        AND ${CAN_EDIT("p", "$1")}
        AND (i.bpm IS NULL
             OR i.bpm_by IS NOT DISTINCT FROM $1
             OR i.bpm_source NOT IN ('tap', 'manual')
             OR tm.bpm_source IN ('tap', 'manual'))
        AND (i.bpm IS DISTINCT FROM tm.bpm OR i.bpm_by IS DISTINCT FROM $1)`,
    [userId, clipKeys],
  );
}

/* ------------------------------------------------------------------ */
/* Track tags (lib/tags.ts)                                            */
/* ------------------------------------------------------------------ */

/**
 * Every tag this user has put on a track, by track. Only ever their own: the
 * one query that reads tags, and it's keyed on the session's user id. Nothing
 * that serves a playlist, a share link, chat or an export joins this table.
 */
export async function listTrackTags(
  userId: string,
): Promise<Array<{ clipKey: string; tags: string[] }>> {
  const rows = await query<{ clip_key: string; tags: string[] }>(
    `SELECT clip_key, array_agg(tag ORDER BY tag COLLATE "C") AS tags
       FROM track_tags
      WHERE user_id = $1
      GROUP BY clip_key`,
    [userId],
  );
  return rows.map((row) => ({ clipKey: row.clip_key, tags: row.tags }));
}

export type SetTrackTagsResult =
  | { ok: true; entries: Array<{ clipKey: string; tags: string[] }> }
  | { ok: false; reason: "limit" };

/**
 * Make each track's tags exactly what's given — already in stored form
 * (lib/tags.normaliseTags) — and say what's stored, in the order asked.
 * One track from the tag editor; up to a couple of hundred at once when a
 * selection is tagged (the route caps a request).
 *
 * A replace, not an add: the request says each track's whole set, so two
 * edits can't interleave into a set nobody chose (the browser sends one at a
 * time per track, newest last, and a selection's tags go through the same
 * queue). Tags already there keep their row and its date.
 *
 * The per-account ceiling (TAG_ROWS_PER_USER) is checked before anything is
 * written, under a lock held for the transaction, so two tabs saving at once
 * can't both squeeze under it. An advisory lock rather than the users row:
 * every request updates that row's last_seen_at, and tagging shouldn't hold
 * up the player's BPM writes. All of a request is written or none of it.
 */
export async function setTrackTags(
  userId: string,
  entries: ReadonlyArray<{ clipKey: string; tags: readonly string[] }>,
): Promise<SetTrackTagsResult> {
  const keys = entries.map((entry) => entry.clipKey);
  if (new Set(keys).size !== keys.length) throw new Error("setTrackTags: a track named twice");
  // (clip, tag) pairs, flattened for one unnest.
  const pairKeys: string[] = [];
  const pairTags: string[] = [];
  for (const entry of entries) {
    for (const tag of entry.tags) {
      pairKeys.push(entry.clipKey);
      pairTags.push(tag);
    }
  }

  return tx(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('track_tags:' || $1, 0))`, [
      userId,
    ]);

    const others = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM track_tags WHERE user_id = $1 AND clip_key <> ALL ($2::text[])`,
      [userId, keys],
    );
    if (Number(others.rows[0]?.n ?? 0) + pairTags.length > TAG_ROWS_PER_USER) {
      return { ok: false, reason: "limit" } as const;
    }

    await client.query(
      `DELETE FROM track_tags t
        WHERE t.user_id = $1
          AND t.clip_key = ANY ($2::text[])
          AND NOT EXISTS (
            SELECT 1 FROM unnest($3::text[], $4::text[]) AS keep(clip_key, tag)
             WHERE keep.clip_key = t.clip_key AND keep.tag = t.tag
          )`,
      [userId, keys, pairKeys, pairTags],
    );
    if (pairTags.length > 0) {
      await client.query(
        `INSERT INTO track_tags (user_id, clip_key, tag)
         SELECT $1, p.clip_key, p.tag FROM unnest($2::text[], $3::text[]) AS p(clip_key, tag)
         ON CONFLICT DO NOTHING`,
        [userId, pairKeys, pairTags],
      );
    }

    const stored = await client.query<{ clip_key: string; tags: string[] }>(
      `SELECT clip_key, array_agg(tag ORDER BY tag COLLATE "C") AS tags
         FROM track_tags
        WHERE user_id = $1 AND clip_key = ANY ($2::text[])
        GROUP BY clip_key`,
      [userId, keys],
    );
    const byKey = new Map(stored.rows.map((row) => [row.clip_key, row.tags]));
    return {
      ok: true,
      entries: keys.map((clipKey) => ({ clipKey, tags: byKey.get(clipKey) ?? [] })),
    } as const;
  });
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
