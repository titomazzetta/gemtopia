-- Gemtopia schema
--
-- Applied idempotently by `npm run db:migrate` (scripts/migrate.mjs).
-- Every statement is safe to re-run.
--
-- Design notes:
--   * Ownership is modelled with a hard FK to `users` and ON DELETE CASCADE,
--     so "delete my account" is one statement and leaves nothing orphaned.
--   * Every user-supplied text column carries a CHECK on length, so a client
--     bug or a hostile request cannot write unbounded data.
--   * `clip_key` is constrained by regex at the database layer as well as in
--     Zod. Defence in depth: the DB is the last place a malformed key can be
--     caught before it is trusted by the recommender.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Discogs usernames are case-insensitive in practice; we store the
  -- lowercased form as the unique key and keep the display form separately.
  username_key      TEXT NOT NULL UNIQUE
                      CHECK (username_key = lower(username_key)
                             AND length(username_key) BETWEEN 1 AND 64),
  username_display  TEXT NOT NULL CHECK (length(username_display) BETWEEN 1 AND 64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- playlists
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS playlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlists_user_updated_idx
  ON playlists (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- playlist_items
--
-- Denormalised on purpose: title/artist/release are copied in so a playlist
-- renders on a device that has not synced that release yet, and so an export
-- is meaningful years later even if the Discogs release is edited or deleted.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS playlist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id   UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 0),
  clip_key      TEXT NOT NULL CHECK (clip_key ~ '^[0-9]+:([A-Za-z0-9_-]{11}|t\.[A-Za-z0-9-]{1,16})$'),
  release_id    BIGINT NOT NULL CHECK (release_id > 0),
  -- NULL for a record-only track (see "Record-only tracks" at the end).
  video_id      TEXT CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title         TEXT NOT NULL CHECK (length(title) <= 400),
  artist        TEXT NOT NULL CHECK (length(artist) <= 400),
  release_title TEXT NOT NULL DEFAULT '' CHECK (length(release_title) <= 400),
  year          INTEGER CHECK (year IS NULL OR year BETWEEN 1880 AND 2200),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlist_items_playlist_position_idx
  ON playlist_items (playlist_id, position);

-- ---------------------------------------------------------------------------
-- track_meta  — the BPM / key catalogue
--
-- Per user, not global: a DJ's tapped tempo is their own truth, and sharing
-- it across accounts would leak listening behaviour between users.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS track_meta (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_key       TEXT NOT NULL CHECK (clip_key ~ '^[0-9]+:([A-Za-z0-9_-]{11}|t\.[A-Za-z0-9-]{1,16})$'),
  bpm            NUMERIC(5,1) CHECK (bpm IS NULL OR bpm BETWEEN 40 AND 260),
  bpm_source     TEXT CHECK (bpm_source IS NULL OR
                             bpm_source IN ('tap','auto','discogs','manual')),
  bpm_confidence REAL CHECK (bpm_confidence IS NULL OR bpm_confidence BETWEEN 0 AND 1),
  musical_key    TEXT CHECK (musical_key IS NULL OR length(musical_key) <= 8),
  rating         SMALLINT CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  cue_note       TEXT CHECK (cue_note IS NULL OR length(cue_note) <= 500),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clip_key)
);

CREATE INDEX IF NOT EXISTS track_meta_user_bpm_idx
  ON track_meta (user_id, bpm)
  WHERE bpm IS NOT NULL;

-- ---------------------------------------------------------------------------
-- analyses — cached playlist dissections and recommendations
--
-- `fingerprint` is a hash of the playlist's clip keys in order. Re-analysing
-- an unchanged playlist is served from here instead of spending Discogs
-- requests and LLM tokens again.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id     UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  fingerprint     TEXT NOT NULL CHECK (length(fingerprint) = 64),
  profile         JSONB NOT NULL,
  recommendations JSONB NOT NULL,
  used_llm        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS analyses_playlist_fingerprint_idx
  ON analyses (playlist_id, fingerprint);

CREATE INDEX IF NOT EXISTS analyses_user_created_idx
  ON analyses (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- llm_usage — cost ceiling accounting for the optional Claude layer
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_user_created_idx
  ON llm_usage (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Playlist visibility
--
-- Playlists are PRIVATE. There is no route in this application that serves a
-- playlist to anyone but its owner, and `visibility` exists so that a future
-- share feature has to be an explicit, deliberate change rather than an
-- accident: the column defaults to 'private', is NOT NULL, and every read path
-- in lib/repo.ts filters by user_id regardless of its value.
--
-- 'unlisted' is reserved for a future share-by-link feature. Nothing reads it
-- yet, and adding a public route would mean adding a new function to repo.ts
-- that deliberately drops the user_id predicate — which is exactly the kind of
-- change that should stand out in a diff.
-- ---------------------------------------------------------------------------

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlists_visibility_check'
  ) THEN
    ALTER TABLE playlists
      ADD CONSTRAINT playlists_visibility_check
      CHECK (visibility IN ('private', 'unlisted'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- dig_log — what the user has already been shown while digging
--
-- Keeps the endless-dig feed from serving the same record every session, and
-- records what was acted on so scoring can learn which lanes are working.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dig_log (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  release_id  BIGINT NOT NULL CHECK (release_id > 0),
  action      TEXT NOT NULL CHECK (action IN ('seen', 'previewed', 'wanted', 'dismissed')),
  seed_id     BIGINT CHECK (seed_id IS NULL OR seed_id > 0),
  lane        TEXT CHECK (lane IS NULL OR length(lane) <= 40),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, release_id, action)
);

CREATE INDEX IF NOT EXISTS dig_log_user_created_idx
  ON dig_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Deck pitch range
--
-- A turntable's pitch fader is a percentage, so this is stored as one. The
-- default is 8 — the Technics SL-1200 range, which is what is in most booths.
-- Everything about mixability (playlist sequencing checks, the "mixes with"
-- filter, the dig drawer's tempo lane) reads from this one number.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pitch_percent SMALLINT NOT NULL DEFAULT 8;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_pitch_percent_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_pitch_percent_check
      CHECK (pitch_percent BETWEEN 1 AND 100);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Session revocation
--
-- Sessions are stateless — the Discogs token lives inside a sealed cookie and
-- there is no session table to delete rows from. That is good for the blast
-- radius of a database breach and bad for revocation: without this column, an
-- exfiltrated cookie stays valid until it expires, and the only kill switch is
-- rotating SESSION_SECRET, which logs out every user at once.
--
-- `session_version` fixes that at the cost of nothing. The version is sealed
-- into the cookie when it is issued and compared on every authenticated
-- request. Bumping it invalidates every session that user holds, everywhere,
-- immediately — and it costs no extra round trip, because the request already
-- touches this row to resolve the username into a user id.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_session_version_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_session_version_check CHECK (session_version >= 1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Share links
--
-- The one deliberate hole in an otherwise strict ownership model, and it is
-- built to look like one.
--
-- Everywhere else, every query in repo.ts takes a user id and puts it in the
-- WHERE clause, so a playlist belonging to someone else is not merely refused
-- — it is unreachable, and returns 404 rather than 403 so the response does
-- not even confirm the id exists. Sharing has to break that, because the whole
-- point is serving a playlist to someone who is not its owner.
--
-- So the break is made narrow and visible:
--
--   * It is opt-in per playlist. `share_token` is NULL until you ask, and
--     setting it back to NULL revokes instantly and permanently — the old link
--     cannot be reinstated, only a new one issued.
--   * The token is the credential. 32 bytes of CSPRNG randomness, base64url,
--     unique. Not the playlist id, not derived from it, and not guessable from
--     any other token: knowing one tells you nothing about another.
--   * It grants read, and only read. There is exactly one function that reads
--     by token (repo.getPlaylistByShareToken) and it returns the tracks and
--     the order and nothing else — no user id, no username, no other playlist,
--     no route to the owner's account.
--
-- The threat this accepts: anyone holding the link can read that playlist.
-- That is what a share link is. The mitigation is that the link is long,
-- random, revocable, and scoped to one playlist.
-- ---------------------------------------------------------------------------

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS share_token TEXT;

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlists_share_token_len'
  ) THEN
    -- A short token is a guessable token. 43 chars is 32 bytes in base64url.
    ALTER TABLE playlists
      ADD CONSTRAINT playlists_share_token_len
      CHECK (share_token IS NULL OR length(share_token) = 43);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS playlists_share_token_key
  ON playlists (share_token)
  WHERE share_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invite-only sign-up
--
-- Turned on by INVITE_ONLY=true. Anyone who already has a row in `users` is a
-- member and keeps their access; someone Gemtopia has never seen needs a
-- one-time code from an admin (ADMIN_USERNAMES).
--
--   * Codes are stored as an HMAC, never as themselves (invite-code.ts). A copy
--     of this table cannot be turned back into a working code without the
--     server secret.
--   * Single use is enforced here, not in application code: redemption is one
--     UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at >
--     now(). Two people racing the same code both run it; the row lock makes
--     the second one re-check, find it used, and match nothing.
--   * A code lives an hour or a day (1 ≤ lifetime ≤ 24 h, checked below), so a
--     code forwarded on dies on its own.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT invite_codes_lifetime
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CONSTRAINT invite_codes_used_consistent
    CHECK (used_by IS NULL OR used_at IS NOT NULL),
  CONSTRAINT invite_codes_used_or_revoked
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS invite_codes_created_by_idx
  ON invite_codes (created_by, created_at DESC);

-- Who let this member in (NULL for everyone who predates invites), and
-- whether an admin has since removed them. Removal also bumps
-- session_version, so it takes effect on the member's very next request.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS access_revoked_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Collaborative playlists
--
-- The second deliberate widening of the ownership model, after share links,
-- and built the same way: narrow, opt-in, revocable, and visible.
--
--   * A playlist still has exactly one owner (`playlists.user_id`). Only the
--     owner can rename it, delete it, make a read-only share link, turn the
--     join link on or off, or remove people.
--   * Collaborators are rows in `playlist_members`. They can read the
--     playlist and change what is in it and in what order — nothing else.
--     Every other user still gets a 404 for it, exactly as before.
--   * People join through a link the owner creates. The link is 32 random
--     bytes; it is looked up by its SHA-256 (`collab_token_hash`) and kept
--     otherwise only sealed with the server key, so a copy of this table does
--     not yield a working link. Turning the link off (NULL)
--     kills it for good; members already in stay until removed or they leave.
--   * Joining needs a Gemtopia account — invite-only still decides who has
--     one — and an explicit "Join" press on the link's page. Nobody is added
--     to anything without doing that themselves.
--   * `version` makes edits safe with more than one editor: every change says
--     which version it was made against, and a stale one is refused (409)
--     instead of silently overwriting someone else's work.
--   * `added_by` records who put each record in, so a back-to-back set knows
--     whose crate each record comes out of.
-- ---------------------------------------------------------------------------

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS collab_token_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlists_collab_token_hash_shape'
  ) THEN
    ALTER TABLE playlists
      ADD CONSTRAINT playlists_collab_token_hash_shape
      CHECK (collab_token_hash IS NULL OR collab_token_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- The same token, sealed with the server key (AES-256-GCM, like the session
-- cookie), so the owner can copy the link again later without minting a new
-- one and breaking the copy they already sent. Useless without SESSION_SECRET.
ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS collab_token_sealed TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS playlists_collab_token_hash_key
  ON playlists (collab_token_hash)
  WHERE collab_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS playlist_members (
  playlist_id  UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, user_id)
);

-- "Which playlists am I a collaborator on?" is asked on every playlist load.
CREATE INDEX IF NOT EXISTS playlist_members_user_idx
  ON playlist_members (user_id);

ALTER TABLE playlist_items
  ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Chat on collaborative playlists
--
-- A message board for the people working on one set: which record goes
-- where, how a blend should go, what to pull. Built to the same rules as the
-- rest of collaboration:
--
--   * Only the owner and collaborators can read or post, through the same
--     access condition as the records (repo.ts CAN_EDIT). Everyone else gets
--     the same 404 as for the playlist itself. A read-only share link never
--     shows the chat.
--   * Leaving or being removed takes your access to the chat with it at
--     once; what you wrote stays, under your name, for the others.
--   * You can delete your own messages; the owner can delete any.
--   * `body` is stored already normalised (src/lib/chat.ts) and the database
--     holds the line too: 1–500 characters, whatever the application does.
--   * Adding or removing records, joining and leaving leave a short note in
--     the chat (kind/meta, below), written by the server.
--   * Only the newest 1000 messages per playlist are kept, and one person can
--     post at most 20 a minute (counted here, so it holds across every
--     serverless instance, unlike the in-memory limiter).
--   * Deleting the playlist deletes its chat.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS playlist_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  playlist_id  UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first pages of one playlist's chat, and its latest id.
CREATE INDEX IF NOT EXISTS playlist_messages_playlist_idx
  ON playlist_messages (playlist_id, id DESC);

-- "How many has this person posted in the last minute?"
CREATE INDEX IF NOT EXISTS playlist_messages_author_idx
  ON playlist_messages (author_id, created_at DESC);

-- Activity notes in the chat: "komron added Shiva — Kerri Chandler",
-- "tito joined". Written only by the server (repo.ts), never posted: the API
-- accepts { body } and nothing else, so `kind` and `meta` cannot come from a
-- request. `meta` is a small object built from rows the server already holds;
-- a text message never has one, a note always does.
ALTER TABLE playlist_messages
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';

ALTER TABLE playlist_messages
  ADD COLUMN IF NOT EXISTS meta JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlist_messages_kind_check'
  ) THEN
    ALTER TABLE playlist_messages
      ADD CONSTRAINT playlist_messages_kind_check
      CHECK (kind IN ('text', 'added', 'removed', 'joined', 'left'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlist_messages_meta_check'
  ) THEN
    ALTER TABLE playlist_messages
      ADD CONSTRAINT playlist_messages_meta_check
      CHECK (
        (kind = 'text' AND meta IS NULL)
        OR (kind <> 'text' AND jsonb_typeof(meta) = 'object'
            AND octet_length(meta::text) <= 2000)
      );
  END IF;
END $$;

-- The set's BPM: one reading per record per playlist, shared by everyone on
-- it, so a back-to-back partner sees your tempos (and set prep agrees on both
-- screens) whether or not they own the record. Written by the server from
-- the BPM catalogue of someone on the playlist (repo.shareBpmWithSets); the
-- latest wins, except an auto-detect never replaces a tap or typed value.
-- Kept with the playlist, so it stays if the person who logged it leaves.
ALTER TABLE playlist_items
  ADD COLUMN IF NOT EXISTS bpm NUMERIC(5,1)
    CHECK (bpm IS NULL OR bpm BETWEEN 40 AND 260);
ALTER TABLE playlist_items
  ADD COLUMN IF NOT EXISTS bpm_source TEXT
    CHECK (bpm_source IS NULL OR bpm_source IN ('tap','auto','discogs','manual'));
ALTER TABLE playlist_items
  ADD COLUMN IF NOT EXISTS bpm_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Fill the sets from the catalogues that already exist: the person who added
-- each record, else the playlist's owner. Only where a set has no BPM yet,
-- so re-running it changes nothing.
UPDATE playlist_items i
   SET bpm = tm.bpm, bpm_source = tm.bpm_source, bpm_by = tm.user_id
  FROM playlists p, track_meta tm
 WHERE p.id = i.playlist_id
   AND i.bpm IS NULL
   AND tm.clip_key = i.clip_key
   AND tm.bpm IS NOT NULL
   AND tm.user_id = COALESCE(i.added_by, p.user_id);

-- How far each person has read each shared playlist's chat, so the unread
-- count is the same on their phone and their laptop. One row per person per
-- playlist, moved forward only (GREATEST), never past the newest message.
-- Goes with the playlist; a collaborator's row goes when they leave or are
-- removed (repo.removeCollaborator).
CREATE TABLE IF NOT EXISTS playlist_reads (
  playlist_id   UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id  BIGINT NOT NULL DEFAULT 0 CHECK (last_read_id >= 0),
  read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Record-only tracks
--
-- A track from a release's Discogs tracklist that YouTube has no clip for.
-- It is keyed `<release id>:t.<position>` (e.g. `123456:t.B2`; src/lib/
-- clipKey.ts) instead of `<release id>:<11-char video id>`. The `t.` prefix
-- can't collide with a clip: YouTube ids never contain a dot. It can go in a
-- playlist and carry a BPM; it has no video, and the player skips it.
--
-- For databases created before this, widen the two clip-key CHECKs, let
-- playlist_items.video_id be NULL, and tie the two together: a row has a
-- video exactly when its key is a clip key. Every statement is a no-op on a
-- second run.
-- ---------------------------------------------------------------------------

ALTER TABLE playlist_items ALTER COLUMN video_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'playlist_items_clip_key_check'
       AND position('|t' in pg_get_constraintdef(oid)) > 0
  ) THEN
    ALTER TABLE playlist_items DROP CONSTRAINT IF EXISTS playlist_items_clip_key_check;
    ALTER TABLE playlist_items ADD CONSTRAINT playlist_items_clip_key_check
      CHECK (clip_key ~ '^[0-9]+:([A-Za-z0-9_-]{11}|t\.[A-Za-z0-9-]{1,16})$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'track_meta_clip_key_check'
       AND position('|t' in pg_get_constraintdef(oid)) > 0
  ) THEN
    ALTER TABLE track_meta DROP CONSTRAINT IF EXISTS track_meta_clip_key_check;
    ALTER TABLE track_meta ADD CONSTRAINT track_meta_clip_key_check
      CHECK (clip_key ~ '^[0-9]+:([A-Za-z0-9_-]{11}|t\.[A-Za-z0-9-]{1,16})$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlist_items_video_matches_key'
  ) THEN
    ALTER TABLE playlist_items ADD CONSTRAINT playlist_items_video_matches_key
      CHECK ((video_id IS NULL) = (clip_key ~ ':t\.'));
  END IF;
END $$;
