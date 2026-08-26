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
  clip_key      TEXT NOT NULL CHECK (clip_key ~ '^[0-9]+:[A-Za-z0-9_-]{11}$'),
  release_id    BIGINT NOT NULL CHECK (release_id > 0),
  video_id      TEXT NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
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
  clip_key       TEXT NOT NULL CHECK (clip_key ~ '^[0-9]+:[A-Za-z0-9_-]{11}$'),
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
